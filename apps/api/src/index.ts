import cors from "cors";
import express from "express";
import { z } from "zod";
import { initDb } from "./db";

const port = Number(process.env.PORT ?? 4010);
const dbPath = process.env.DB_PATH;
const db = initDb(dbPath);

const app = express();

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

app.get("/health", (_req, res) => {
  res.json({ ok: true, port, dbPath: dbPath ?? "./data/aso.sqlite" });
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

  const country = parsed.data.country.toUpperCase();
  const language = parsed.data.language.toLowerCase();

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
    lastRun: lastRun ?? null
  });
});

app.post("/crawl/run", (_req, res) => {
  const startedAt = new Date().toISOString();
  const insert = db
    .prepare("INSERT INTO runs (status, started_at, finished_at, total_targets, successful_targets) VALUES (?, ?, ?, ?, ?)")
    .run("completed", startedAt, new Date().toISOString(), 0, 0);

  res.json({
    runId: insert.lastInsertRowid,
    status: "completed",
    message: "Crawler servisi henuz entegre edilmedi. Bu endpoint MVP placeholder olarak calisiyor."
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "Beklenmeyen sunucu hatasi", details: String(err) });
});

app.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://127.0.0.1:${port}`);
});
