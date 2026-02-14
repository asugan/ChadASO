import cors from "cors";
import { config as loadEnv } from "dotenv";
import express from "express";
import { resolve } from "node:path";
import store from "app-store-scraper";
import { z } from "zod";
import { initDb } from "./db";

loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "..", "..", ".env") });

const port = Number(process.env.PORT ?? 4010);
const dbPath = process.env.DB_PATH;
const db = initDb(dbPath);

const app = express();
let crawlRunning = false;
let asaRunning = false;

const asaConfig = {
  baseUrl: (process.env.ASA_API_BASE_URL ?? "https://api.searchads.apple.com/api/v5").replace(/\/$/, ""),
  tokenUrl: process.env.ASA_TOKEN_URL ?? "https://appleid.apple.com/auth/oauth2/token",
  orgId: (process.env.ASA_ORG_ID ?? "").trim(),
  clientId: (process.env.ASA_CLIENT_ID ?? "").trim(),
  clientSecret: (process.env.ASA_CLIENT_SECRET ?? "").trim(),
  scope: process.env.ASA_SCOPE ?? "searchadsorg",
  popularityPath: process.env.ASA_POPULARITY_PATH ?? "/searchterms/popularity",
  requestTimeoutMs: Number(process.env.ASA_REQUEST_TIMEOUT_MS ?? 20000)
};

let asaTokenCache: { token: string; expiresAt: number } | null = null;

app.use(cors());
app.use(express.json());

const appSchema = z.object({
  name: z.string().min(1),
  storeId: z.string().min(1),
  bundleId: z.string().optional(),
  platform: z.string().default("ios")
});

const keywordSchema = z.object({
  term: z.string().min(1)
});

const localeSchema = z.object({
  country: z.string().min(2).max(2),
  language: z.string().min(2).max(5).default("en")
});

const targetSchema = z.object({
  appId: z.number().int().positive(),
  keywordId: z.number().int().positive(),
  localeId: z.number().int().positive()
});

const asaSyncSchema = z.object({
  localeId: z.number().int().positive().optional(),
  keywordIds: z.array(z.number().int().positive()).optional()
});

type CrawlTarget = {
  targetId: number;
  appId: number;
  appStoreId: string;
  appName: string;
  keyword: string;
  localeId: number;
  country: string;
  language: string;
};

type SearchCandidate = {
  id?: string | number;
  trackId?: string | number;
};

type AppMetadata = {
  title?: string;
  subtitle?: string;
  description?: string;
};

type AsaTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type AsaPopularityLocale = {
  id: number;
  country: string;
  language: string;
};

type AsaPopularityKeyword = {
  id: number;
  term: string;
};

function normalizeCountry(country: string) {
  return country.trim().toUpperCase();
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase();
}

function extractStoreId(candidate: SearchCandidate) {
  const raw = candidate.id ?? candidate.trackId;
  return raw ? String(raw) : null;
}

async function fetchKeywordRank(target: CrawlTarget) {
  const results = (await store.search({
    term: target.keyword,
    num: 200,
    country: target.country,
    lang: target.language,
    device: store.device.IPHONE
  })) as SearchCandidate[];

  const rank = results.findIndex((item) => extractStoreId(item) === target.appStoreId);
  return rank >= 0 ? rank + 1 : null;
}

async function fetchMetadata(target: CrawlTarget) {
  const appStoreIdNumber = Number(target.appStoreId);

  if (!Number.isInteger(appStoreIdNumber) || appStoreIdNumber <= 0) {
    return null;
  }

  const metadata = (await store.app({
    id: appStoreIdNumber,
    country: target.country,
    lang: target.language
  })) as AppMetadata;

  return {
    title: metadata.title ?? null,
    subtitle: metadata.subtitle ?? null,
    description: metadata.description ?? null
  };
}

function getActiveTargets() {
  return db
    .prepare(
      `SELECT
        t.id as targetId,
        a.id as appId,
        a.store_id as appStoreId,
        a.name as appName,
        k.term as keyword,
        l.id as localeId,
        l.country as country,
        l.language as language
      FROM tracking_targets t
      JOIN apps a ON a.id = t.app_id
      JOIN keywords k ON k.id = t.keyword_id
      JOIN locales l ON l.id = t.locale_id
      WHERE t.active = 1
      ORDER BY t.id ASC`
    )
    .all() as CrawlTarget[];
}

function isAsaConfigured() {
  return Boolean(asaConfig.orgId && asaConfig.clientId && asaConfig.clientSecret);
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

async function getAsaAccessToken() {
  const now = Date.now();
  if (asaTokenCache && asaTokenCache.expiresAt > now + 30_000) {
    return asaTokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: asaConfig.scope,
    client_id: asaConfig.clientId,
    client_secret: asaConfig.clientSecret
  });

  const request = withTimeout(asaConfig.requestTimeoutMs);

  try {
    const response = await fetch(asaConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: request.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ASA token request failed: ${response.status} ${text}`);
    }

    const json = (await response.json()) as AsaTokenResponse;
    const accessToken = json.access_token;

    if (!accessToken) {
      throw new Error("ASA token response did not include access_token");
    }

    const expiresIn = Number(json.expires_in ?? 3600);
    asaTokenCache = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    };

    return accessToken;
  } finally {
    request.clear();
  }
}

function normalizeTerm(term: string) {
  return term.trim().toLowerCase();
}

function parsePopularityValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(100, Math.round(parsed)));
    }
  }

  return null;
}

function collectObjects(value: unknown, sink: Array<Record<string, unknown>>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, sink));
    return;
  }

  if (value && typeof value === "object") {
    const objectRecord = value as Record<string, unknown>;
    sink.push(objectRecord);
    Object.values(objectRecord).forEach((nested) => collectObjects(nested, sink));
  }
}

function extractPopularityMap(payload: unknown, terms: string[]) {
  const allowedTerms = new Set(terms.map((item) => normalizeTerm(item)));
  const objects: Array<Record<string, unknown>> = [];
  collectObjects(payload, objects);

  const result = new Map<string, number>();
  const termKeys = ["term", "keyword", "text", "searchTerm", "query"];
  const scoreKeys = ["popularity", "popularityScore", "searchPopularity", "score", "value", "rank"];

  for (const item of objects) {
    const termRaw = termKeys.map((key) => item[key]).find((value) => typeof value === "string");
    if (typeof termRaw !== "string") {
      continue;
    }

    const normalized = normalizeTerm(termRaw);
    if (!allowedTerms.has(normalized)) {
      continue;
    }

    const scoreRaw = scoreKeys.map((key) => item[key]).find((value) => value !== undefined && value !== null);
    const score = parsePopularityValue(scoreRaw);
    if (score === null) {
      continue;
    }

    const previous = result.get(normalized);
    if (previous === undefined || score > previous) {
      result.set(normalized, score);
    }
  }

  return result;
}

async function requestPopularityMap(terms: string[], country: string, language: string) {
  const token = await getAsaAccessToken();

  const payloadCandidates: Array<Record<string, unknown>> = [
    { terms, countryOrRegion: country, language },
    { keywords: terms, countryOrRegion: country, language },
    { searchTerms: terms, countryOrRegion: country, language }
  ];

  const path = asaConfig.popularityPath.startsWith("/") ? asaConfig.popularityPath : `/${asaConfig.popularityPath}`;
  const url = `${asaConfig.baseUrl}${path}`;
  const errors: string[] = [];

  for (const payload of payloadCandidates) {
    const request = withTimeout(asaConfig.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-AP-Context": `orgId=${asaConfig.orgId}`
        },
        body: JSON.stringify(payload),
        signal: request.signal
      });

      if (!response.ok) {
        errors.push(`status=${response.status}`);
        continue;
      }

      const json = (await response.json()) as unknown;
      const popularityMap = extractPopularityMap(json, terms);
      if (popularityMap.size > 0) {
        return popularityMap;
      }

      errors.push("response parsed but no popularity values were found");
    } catch (error) {
      errors.push(String(error));
    } finally {
      request.clear();
    }
  }

  throw new Error(`ASA popularity request failed. Check ASA_POPULARITY_PATH or credentials. Details: ${errors.join(" | ")}`);
}

function getAsaLocales(localeId?: number) {
  if (localeId) {
    return db
      .prepare("SELECT id, country, language FROM locales WHERE id = ?")
      .all(localeId) as AsaPopularityLocale[];
  }

  return db
    .prepare("SELECT id, country, language FROM locales ORDER BY id ASC")
    .all() as AsaPopularityLocale[];
}

function getAsaKeywords(keywordIds?: number[]) {
  if (!keywordIds || keywordIds.length === 0) {
    return db
      .prepare("SELECT id, term FROM keywords ORDER BY id ASC")
      .all() as AsaPopularityKeyword[];
  }

  const placeholders = keywordIds.map(() => "?").join(", ");
  return db
    .prepare(`SELECT id, term FROM keywords WHERE id IN (${placeholders}) ORDER BY id ASC`)
    .all(...keywordIds) as AsaPopularityKeyword[];
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    port,
    dbPath: dbPath ?? "./data/aso.sqlite",
    asaConfigured: isAsaConfigured()
  });
});

app.get("/apps", (_req, res) => {
  const rows = db
    .prepare("SELECT id, name, store_id as storeId, bundle_id as bundleId, platform, created_at as createdAt FROM apps ORDER BY id DESC")
    .all();
  res.json(rows);
});

app.post("/apps", (req, res) => {
  const parsed = appSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { name, storeId, bundleId, platform } = parsed.data;

  try {
    const result = db
      .prepare("INSERT INTO apps (name, store_id, bundle_id, platform) VALUES (?, ?, ?, ?)")
      .run(name, storeId, bundleId ?? null, platform);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(409).json({ error: "App zaten kayitli olabilir.", details: String(error) });
  }
});

app.get("/keywords", (_req, res) => {
  const rows = db
    .prepare("SELECT id, term, created_at as createdAt FROM keywords ORDER BY id DESC")
    .all();
  res.json(rows);
});

app.post("/keywords", (req, res) => {
  const parsed = keywordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = db.prepare("INSERT INTO keywords (term) VALUES (?)").run(parsed.data.term.trim());
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(409).json({ error: "Keyword zaten kayitli olabilir.", details: String(error) });
  }
});

app.get("/locales", (_req, res) => {
  const rows = db
    .prepare("SELECT id, country, language FROM locales ORDER BY country ASC, language ASC")
    .all();
  res.json(rows);
});

app.post("/locales", (req, res) => {
  const parsed = localeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const country = normalizeCountry(parsed.data.country);
  const language = normalizeLanguage(parsed.data.language);

  try {
    const result = db
      .prepare("INSERT INTO locales (country, language) VALUES (?, ?)")
      .run(country, language);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(409).json({ error: "Locale zaten kayitli olabilir.", details: String(error) });
  }
});

app.get("/targets", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
        t.id,
        t.active,
        a.id as appId,
        a.name as appName,
        k.id as keywordId,
        k.term as keyword,
        l.id as localeId,
        l.country as country,
        l.language as language,
        t.created_at as createdAt
      FROM tracking_targets t
      JOIN apps a ON a.id = t.app_id
      JOIN keywords k ON k.id = t.keyword_id
      JOIN locales l ON l.id = t.locale_id
      ORDER BY t.id DESC`
    )
    .all();

  res.json(rows);
});

app.post("/targets", (req, res) => {
  const parsed = targetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { appId, keywordId, localeId } = parsed.data;

  try {
    const result = db
      .prepare("INSERT INTO tracking_targets (app_id, keyword_id, locale_id) VALUES (?, ?, ?)")
      .run(appId, keywordId, localeId);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(409).json({ error: "Target zaten kayitli olabilir.", details: String(error) });
  }
});

app.get("/dashboard/summary", (_req, res) => {
  const appsCount = db.prepare("SELECT COUNT(*) as count FROM apps").get() as { count: number };
  const keywordsCount = db.prepare("SELECT COUNT(*) as count FROM keywords").get() as { count: number };
  const localesCount = db.prepare("SELECT COUNT(*) as count FROM locales").get() as { count: number };
  const targetsCount = db.prepare("SELECT COUNT(*) as count FROM tracking_targets").get() as { count: number };
  const lastRun = db
    .prepare("SELECT id, status, started_at as startedAt, finished_at as finishedAt FROM runs ORDER BY id DESC LIMIT 1")
    .get();

  res.json({
    apps: appsCount.count,
    keywords: keywordsCount.count,
    locales: localesCount.count,
    targets: targetsCount.count,
    crawlerRunning: crawlRunning,
    asaRunning,
    asaConfigured: isAsaConfigured(),
    lastRun: lastRun ?? null
  });
});

app.get("/runs", (_req, res) => {
  const rows = db
    .prepare(
      "SELECT id, status, started_at as startedAt, finished_at as finishedAt, error, total_targets as totalTargets, successful_targets as successfulTargets FROM runs ORDER BY id DESC LIMIT 30"
    )
    .all();

  res.json(rows);
});

app.get("/rankings/latest", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
        t.id as targetId,
        a.name as appName,
        k.term as keyword,
        l.country as country,
        l.language as language,
        (
          SELECT rs.rank
          FROM rank_snapshots rs
          WHERE rs.target_id = t.id
          ORDER BY rs.checked_at DESC, rs.id DESC
          LIMIT 1
        ) as rank,
        (
          SELECT rs.found
          FROM rank_snapshots rs
          WHERE rs.target_id = t.id
          ORDER BY rs.checked_at DESC, rs.id DESC
          LIMIT 1
        ) as found,
        (
          SELECT rs.checked_at
          FROM rank_snapshots rs
          WHERE rs.target_id = t.id
          ORDER BY rs.checked_at DESC, rs.id DESC
          LIMIT 1
        ) as checkedAt,
        (
          SELECT rs.rank
          FROM rank_snapshots rs
          WHERE rs.target_id = t.id
          ORDER BY rs.checked_at DESC, rs.id DESC
          LIMIT 1 OFFSET 1
        ) as previousRank,
        (
          SELECT kp.popularity_score
          FROM keyword_popularity_snapshots kp
          WHERE kp.keyword_id = t.keyword_id AND kp.locale_id = t.locale_id
          ORDER BY kp.checked_at DESC, kp.id DESC
          LIMIT 1
        ) as popularity
      FROM tracking_targets t
      JOIN apps a ON a.id = t.app_id
      JOIN keywords k ON k.id = t.keyword_id
      JOIN locales l ON l.id = t.locale_id
      WHERE t.active = 1
      ORDER BY appName ASC, keyword ASC, country ASC, language ASC`
    )
    .all() as Array<{
      targetId: number;
      appName: string;
      keyword: string;
      country: string;
      language: string;
      rank: number | null;
      found: number | null;
      checkedAt: string | null;
      previousRank: number | null;
      popularity: number | null;
    }>;

  const normalized = rows.map((item) => {
    let delta: number | null = null;
    if (item.rank !== null && item.previousRank !== null) {
      delta = item.previousRank - item.rank;
    }

    return {
      ...item,
      found: Boolean(item.found),
      delta
    };
  });

  res.json(normalized);
});

app.get("/asa/status", (_req, res) => {
  res.json({
    configured: isAsaConfigured(),
    running: asaRunning,
    baseUrl: asaConfig.baseUrl,
    popularityPath: asaConfig.popularityPath,
    orgIdConfigured: Boolean(asaConfig.orgId),
    clientIdConfigured: Boolean(asaConfig.clientId),
    clientSecretConfigured: Boolean(asaConfig.clientSecret)
  });
});

app.get("/asa/runs", (_req, res) => {
  const rows = db
    .prepare(
      "SELECT id, status, started_at as startedAt, finished_at as finishedAt, error, total_keywords as totalKeywords, successful_keywords as successfulKeywords FROM asa_runs ORDER BY id DESC LIMIT 30"
    )
    .all();

  res.json(rows);
});

app.get("/asa/popularity/latest", (req, res) => {
  const localeIdRaw = typeof req.query.localeId === "string" ? Number(req.query.localeId) : undefined;
  const hasLocaleFilter = Number.isInteger(localeIdRaw) && (localeIdRaw ?? 0) > 0;

  const query = hasLocaleFilter
    ? `SELECT
        k.id as keywordId,
        k.term as keyword,
        l.id as localeId,
        l.country as country,
        l.language as language,
        kp.popularity_score as popularityScore,
        kp.checked_at as checkedAt
      FROM keyword_popularity_snapshots kp
      JOIN keywords k ON k.id = kp.keyword_id
      JOIN locales l ON l.id = kp.locale_id
      WHERE kp.id = (
        SELECT kp2.id
        FROM keyword_popularity_snapshots kp2
        WHERE kp2.keyword_id = kp.keyword_id AND kp2.locale_id = kp.locale_id
        ORDER BY kp2.checked_at DESC, kp2.id DESC
        LIMIT 1
      )
      AND l.id = ?
      ORDER BY keyword ASC`
    : `SELECT
        k.id as keywordId,
        k.term as keyword,
        l.id as localeId,
        l.country as country,
        l.language as language,
        kp.popularity_score as popularityScore,
        kp.checked_at as checkedAt
      FROM keyword_popularity_snapshots kp
      JOIN keywords k ON k.id = kp.keyword_id
      JOIN locales l ON l.id = kp.locale_id
      WHERE kp.id = (
        SELECT kp2.id
        FROM keyword_popularity_snapshots kp2
        WHERE kp2.keyword_id = kp.keyword_id AND kp2.locale_id = kp.locale_id
        ORDER BY kp2.checked_at DESC, kp2.id DESC
        LIMIT 1
      )
      ORDER BY keyword ASC, country ASC, language ASC`;

  const rows = hasLocaleFilter ? db.prepare(query).all(localeIdRaw) : db.prepare(query).all();
  res.json(rows);
});

app.post("/asa/popularity/sync", async (req, res) => {
  if (asaRunning) {
    res.status(409).json({ error: "ASA sync zaten calisiyor." });
    return;
  }

  if (!isAsaConfigured()) {
    res.status(400).json({
      error: "ASA credentials eksik. ASA_ORG_ID, ASA_CLIENT_ID, ASA_CLIENT_SECRET env degerlerini girin."
    });
    return;
  }

  const parsed = asaSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const locales = getAsaLocales(parsed.data.localeId);
  const keywords = getAsaKeywords(parsed.data.keywordIds);

  if (locales.length === 0) {
    res.status(404).json({ error: "Sync icin locale bulunamadi." });
    return;
  }

  if (keywords.length === 0) {
    res.status(404).json({ error: "Sync icin keyword bulunamadi." });
    return;
  }

  const startedAt = new Date().toISOString();
  const totalKeywords = locales.length * keywords.length;
  const runInsert = db
    .prepare("INSERT INTO asa_runs (status, started_at, total_keywords, successful_keywords) VALUES (?, ?, ?, ?)")
    .run("running", startedAt, totalKeywords, 0);

  const asaRunId = Number(runInsert.lastInsertRowid);
  const errors: string[] = [];
  let successfulKeywords = 0;

  asaRunning = true;

  try {
    const keywordChunks = chunkArray(keywords, 20);

    for (const locale of locales) {
      for (const chunk of keywordChunks) {
        const checkedAt = new Date().toISOString();

        try {
          const popularityMap = await requestPopularityMap(
            chunk.map((item) => item.term),
            locale.country,
            locale.language
          );

          for (const keyword of chunk) {
            const score = popularityMap.get(normalizeTerm(keyword.term)) ?? null;
            if (score !== null) {
              successfulKeywords += 1;
            }

            db.prepare(
              "INSERT INTO keyword_popularity_snapshots (keyword_id, locale_id, asa_run_id, popularity_score, source, checked_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(keyword.id, locale.id, asaRunId, score, "asa_api", checkedAt);
          }
        } catch (error) {
          errors.push(
            `locale=${locale.country}/${locale.language} keywords=${chunk.map((item) => item.term).join(",")} error=${String(error)}`
          );

          for (const keyword of chunk) {
            db.prepare(
              "INSERT INTO keyword_popularity_snapshots (keyword_id, locale_id, asa_run_id, popularity_score, source, checked_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(keyword.id, locale.id, asaRunId, null, "asa_api", checkedAt);
          }
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const status = errors.length > 0 ? (successfulKeywords > 0 ? "completed_with_errors" : "failed") : "completed";

    db.prepare(
      "UPDATE asa_runs SET status = ?, finished_at = ?, error = ?, total_keywords = ?, successful_keywords = ? WHERE id = ?"
    ).run(
      status,
      finishedAt,
      errors.length > 0 ? errors.join("\n").slice(0, 4000) : null,
      totalKeywords,
      successfulKeywords,
      asaRunId
    );

    res.json({
      asaRunId,
      status,
      locales: locales.length,
      keywords: keywords.length,
      totalKeywords,
      successfulKeywords,
      failedKeywords: totalKeywords - successfulKeywords,
      errorCount: errors.length
    });
  } catch (error) {
    db.prepare(
      "UPDATE asa_runs SET status = ?, finished_at = ?, error = ?, total_keywords = ?, successful_keywords = ? WHERE id = ?"
    ).run("failed", new Date().toISOString(), String(error), totalKeywords, successfulKeywords, asaRunId);

    res.status(500).json({ error: "ASA popularity sync basarisiz oldu.", details: String(error), asaRunId });
  } finally {
    asaRunning = false;
  }
});

app.post("/crawl/run", async (_req, res) => {
  if (crawlRunning) {
    res.status(409).json({ error: "Crawler zaten calisiyor." });
    return;
  }

  const targets = getActiveTargets();
  const startedAt = new Date().toISOString();
  const runInsert = db
    .prepare("INSERT INTO runs (status, started_at, total_targets, successful_targets) VALUES (?, ?, ?, ?)")
    .run("running", startedAt, targets.length, 0);

  const runId = Number(runInsert.lastInsertRowid);
  const metadataCaptured = new Set<string>();
  let successfulTargets = 0;
  const errors: string[] = [];

  crawlRunning = true;

  try {
    for (const target of targets) {
      const checkedAt = new Date().toISOString();

      try {
        const rank = await fetchKeywordRank(target);

        db.prepare(
          "INSERT INTO rank_snapshots (target_id, run_id, rank, found, source, checked_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(target.targetId, runId, rank, rank === null ? 0 : 1, "app-store-scraper", checkedAt);

        successfulTargets += 1;
      } catch (error) {
        errors.push(`target=${target.targetId} keyword=${target.keyword} error=${String(error)}`);
      }

      const metadataKey = `${target.appId}:${target.localeId}`;
      if (!metadataCaptured.has(metadataKey)) {
        metadataCaptured.add(metadataKey);

        try {
          const metadata = await fetchMetadata(target);
          if (metadata) {
            db.prepare(
              "INSERT INTO metadata_snapshots (app_id, locale_id, title, subtitle, description, checked_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(target.appId, target.localeId, metadata.title, metadata.subtitle, metadata.description, checkedAt);
          }
        } catch (error) {
          errors.push(`metadata app=${target.appId} locale=${target.localeId} error=${String(error)}`);
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const status = errors.length > 0 ? (successfulTargets > 0 ? "completed_with_errors" : "failed") : "completed";

    db.prepare(
      "UPDATE runs SET status = ?, finished_at = ?, error = ?, total_targets = ?, successful_targets = ? WHERE id = ?"
    ).run(
      status,
      finishedAt,
      errors.length > 0 ? errors.join("\n").slice(0, 4000) : null,
      targets.length,
      successfulTargets,
      runId
    );

    res.json({
      runId,
      status,
      totalTargets: targets.length,
      successfulTargets,
      failedTargets: targets.length - successfulTargets,
      errorCount: errors.length
    });
  } catch (error) {
    db.prepare(
      "UPDATE runs SET status = ?, finished_at = ?, error = ?, total_targets = ?, successful_targets = ? WHERE id = ?"
    ).run("failed", new Date().toISOString(), String(error), targets.length, successfulTargets, runId);

    res.status(500).json({ error: "Crawler run basarisiz oldu.", details: String(error), runId });
  } finally {
    crawlRunning = false;
  }
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "Beklenmeyen sunucu hatasi", details: String(err) });
});

app.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://127.0.0.1:${port}`);
});
