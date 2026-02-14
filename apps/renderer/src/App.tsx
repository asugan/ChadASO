import { FormEvent, useEffect, useMemo, useState } from "react";

type AppRecord = {
  id: number;
  name: string;
  storeId: string;
  platform: string;
};

type KeywordRecord = {
  id: number;
  term: string;
};

type LocaleRecord = {
  id: number;
  country: string;
  language: string;
};

type TargetRecord = {
  id: number;
  appId: number;
  appName: string;
  keywordId: number;
  keyword: string;
  localeId: number;
  country: string;
  language: string;
  active: number;
};

type RunRecord = {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  totalTargets: number;
  successfulTargets: number;
};

type LatestRanking = {
  targetId: number;
  appName: string;
  keyword: string;
  country: string;
  language: string;
  rank: number | null;
  previousRank: number | null;
  delta: number | null;
  checkedAt: string | null;
  popularity: number | null;
};

type AsaStatus = {
  configured: boolean;
  running: boolean;
  baseUrl: string;
  popularityPath: string;
  orgIdConfigured: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
};

type AsaPopularityRow = {
  keywordId: number;
  keyword: string;
  localeId: number;
  country: string;
  language: string;
  popularityScore: number | null;
  checkedAt: string;
};

type Summary = {
  apps: number;
  keywords: number;
  locales: number;
  targets: number;
  crawlerRunning: boolean;
  asaRunning: boolean;
  asaConfigured: boolean;
  lastRun: { id: number; status: string; startedAt: string; finishedAt: string | null } | null;
};

type CrawlResponse = {
  runId: number;
  status: string;
  totalTargets: number;
  successfulTargets: number;
  failedTargets: number;
  errorCount: number;
};

type AsaSyncResponse = {
  asaRunId: number;
  status: string;
  totalKeywords: number;
  successfulKeywords: number;
  failedKeywords: number;
  errorCount: number;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4010";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Request failed");
  }

  return res.json() as Promise<T>;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export default function App() {
  const [health, setHealth] = useState<string>("checking...");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [keywords, setKeywords] = useState<KeywordRecord[]>([]);
  const [locales, setLocales] = useState<LocaleRecord[]>([]);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [latestRankings, setLatestRankings] = useState<LatestRanking[]>([]);
  const [latestPopularity, setLatestPopularity] = useState<AsaPopularityRow[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [asaStatus, setAsaStatus] = useState<AsaStatus | null>(null);
  const [error, setError] = useState<string>("");
  const [crawlMessage, setCrawlMessage] = useState<string>("");
  const [asaMessage, setAsaMessage] = useState<string>("");
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [asaLoading, setAsaLoading] = useState(false);

  const [appName, setAppName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [term, setTerm] = useState("");
  const [country, setCountry] = useState("US");
  const [language, setLanguage] = useState("en");
  const [targetAppId, setTargetAppId] = useState<number | null>(null);
  const [targetKeywordId, setTargetKeywordId] = useState<number | null>(null);
  const [targetLocaleId, setTargetLocaleId] = useState<number | null>(null);

  const counts = useMemo(() => {
    if (!summary) {
      return [
        ["Apps", "-"],
        ["Keywords", "-"],
        ["Locales", "-"],
        ["Targets", "-"]
      ];
    }

    return [
      ["Apps", summary.apps],
      ["Keywords", summary.keywords],
      ["Locales", summary.locales],
      ["Targets", summary.targets]
    ];
  }, [summary]);

  async function refreshAll() {
    try {
      setError("");
      const [healthRes, appsRes, keywordsRes, localesRes, targetsRes, summaryRes, latestRes, runsRes, asaStatusRes, popularityRes] =
        await Promise.all([
          api<{ ok: boolean; asaConfigured: boolean }>("/health"),
        api<AppRecord[]>("/apps"),
        api<KeywordRecord[]>("/keywords"),
        api<LocaleRecord[]>("/locales"),
        api<TargetRecord[]>("/targets"),
        api<Summary>("/dashboard/summary"),
        api<LatestRanking[]>("/rankings/latest"),
          api<RunRecord[]>("/runs"),
          api<AsaStatus>("/asa/status"),
          api<AsaPopularityRow[]>("/asa/popularity/latest")
        ]);

      setHealth(healthRes.ok ? "online" : "offline");
      setApps(appsRes);
      setKeywords(keywordsRes);
      setLocales(localesRes);
      setTargets(targetsRes);
      setSummary(summaryRes);
      setLatestRankings(latestRes);
      setRuns(runsRes);
      setAsaStatus(asaStatusRes);
      setLatestPopularity(popularityRes);

      if (!targetAppId && appsRes.length > 0) {
        setTargetAppId(appsRes[0].id);
      }

      if (!targetKeywordId && keywordsRes.length > 0) {
        setTargetKeywordId(keywordsRes[0].id);
      }

      if (!targetLocaleId && localesRes.length > 0) {
        setTargetLocaleId(localesRes[0].id);
      }
    } catch (e) {
      setHealth("offline");
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  async function onAddApp(e: FormEvent) {
    e.preventDefault();
    if (!appName || !storeId) {
      return;
    }

    try {
      await api<{ id: number }>("/apps", {
        method: "POST",
        body: JSON.stringify({ name: appName, storeId, platform: "ios" })
      });

      setAppName("");
      setStoreId("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add app");
    }
  }

  async function onAddKeyword(e: FormEvent) {
    e.preventDefault();
    if (!term) {
      return;
    }

    try {
      await api<{ id: number }>("/keywords", {
        method: "POST",
        body: JSON.stringify({ term })
      });

      setTerm("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add keyword");
    }
  }

  async function onAddLocale(e: FormEvent) {
    e.preventDefault();
    if (!country || !language) {
      return;
    }

    try {
      await api<{ id: number }>("/locales", {
        method: "POST",
        body: JSON.stringify({ country, language })
      });

      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add locale");
    }
  }

  async function onAddTarget(e: FormEvent) {
    e.preventDefault();
    if (!targetAppId || !targetKeywordId || !targetLocaleId) {
      return;
    }

    try {
      await api<{ id: number }>("/targets", {
        method: "POST",
        body: JSON.stringify({ appId: targetAppId, keywordId: targetKeywordId, localeId: targetLocaleId })
      });

      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add target");
    }
  }

  async function onRunCrawl() {
    try {
      setError("");
      setCrawlLoading(true);
      const result = await api<CrawlResponse>("/crawl/run", { method: "POST" });
      setCrawlMessage(
        `Run #${result.runId} ${result.status} | total=${result.totalTargets}, success=${result.successfulTargets}, failed=${result.failedTargets}`
      );
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Crawler run failed");
    } finally {
      setCrawlLoading(false);
    }
  }

  async function onRunAsaSync() {
    try {
      setError("");
      setAsaLoading(true);
      const result = await api<AsaSyncResponse>("/asa/popularity/sync", { method: "POST", body: JSON.stringify({}) });
      setAsaMessage(
        `ASA run #${result.asaRunId} ${result.status} | total=${result.totalKeywords}, success=${result.successfulKeywords}, failed=${result.failedKeywords}`
      );
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ASA popularity sync failed");
    } finally {
      setAsaLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>ASO Tool</h1>
          <p>Electron + Express + SQLite starter dashboard</p>
        </div>
        <div className={`badge ${health === "online" ? "ok" : "bad"}`}>API: {health}</div>
      </header>

      {error ? <div className="error">{error}</div> : null}
      {crawlMessage ? <div className="success">{crawlMessage}</div> : null}
      {asaMessage ? <div className="success">{asaMessage}</div> : null}

      <section className="runBar">
        <div className="actions">
          <button onClick={onRunCrawl} disabled={crawlLoading || summary?.crawlerRunning}>
            {crawlLoading || summary?.crawlerRunning ? "Crawler running..." : "Run Crawl Now"}
          </button>
          <button
            onClick={onRunAsaSync}
            disabled={asaLoading || summary?.asaRunning || !summary?.asaConfigured}
            className="secondary"
          >
            {asaLoading || summary?.asaRunning ? "ASA syncing..." : "Sync ASA Popularity"}
          </button>
        </div>
        <small>
          Last run: {summary?.lastRun ? `#${summary.lastRun.id} (${summary.lastRun.status})` : "none"} | started:
          {" "}
          {summary?.lastRun ? formatTimestamp(summary.lastRun.startedAt) : "-"}
          {" "}| ASA: {asaStatus?.configured ? "configured" : "not configured"}
        </small>
      </section>

      <section className="cards">
        {counts.map(([label, value]) => (
          <article className="card" key={String(label)}>
            <span>{label}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>

      <section className="grid grid-four">
        <article className="panel">
          <h2>Add App</h2>
          <form onSubmit={onAddApp}>
            <input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="App name" required />
            <input value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="App Store ID" required />
            <button type="submit">Save App</button>
          </form>
        </article>

        <article className="panel">
          <h2>Add Keyword</h2>
          <form onSubmit={onAddKeyword}>
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Keyword" required />
            <button type="submit">Save Keyword</button>
          </form>
        </article>

        <article className="panel">
          <h2>Add Locale</h2>
          <form onSubmit={onAddLocale}>
            <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="Country (US)" required />
            <input value={language} onChange={(e) => setLanguage(e.target.value.toLowerCase())} placeholder="Language (en)" required />
            <button type="submit">Save Locale</button>
          </form>
        </article>

        <article className="panel">
          <h2>Add Target</h2>
          <form onSubmit={onAddTarget}>
            <select
              value={targetAppId ?? ""}
              onChange={(e) => setTargetAppId(Number(e.target.value))}
              disabled={apps.length === 0}
            >
              {apps.length === 0 ? <option value="">No apps</option> : null}
              {apps.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={targetKeywordId ?? ""}
              onChange={(e) => setTargetKeywordId(Number(e.target.value))}
              disabled={keywords.length === 0}
            >
              {keywords.length === 0 ? <option value="">No keywords</option> : null}
              {keywords.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.term}
                </option>
              ))}
            </select>
            <select
              value={targetLocaleId ?? ""}
              onChange={(e) => setTargetLocaleId(Number(e.target.value))}
              disabled={locales.length === 0}
            >
              {locales.length === 0 ? <option value="">No locales</option> : null}
              {locales.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.country}/{item.language}
                </option>
              ))}
            </select>
            <button type="submit">Save Target</button>
          </form>
        </article>
      </section>

      <section className="grid grid-two">
        <article className="panel">
          <h2>Tracking Targets</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Keyword</th>
                  <th>Locale</th>
                </tr>
              </thead>
              <tbody>
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No targets yet</td>
                  </tr>
                ) : (
                  targets.map((item) => (
                    <tr key={item.id}>
                      <td>{item.appName}</td>
                      <td>{item.keyword}</td>
                      <td>
                        {item.country}/{item.language}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h2>Latest Rankings</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Keyword</th>
                  <th>Locale</th>
                  <th>Popularity</th>
                  <th>Rank</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                {latestRankings.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No ranking data yet</td>
                  </tr>
                ) : (
                  latestRankings.map((item) => (
                    <tr key={item.targetId}>
                      <td>{item.appName}</td>
                      <td>{item.keyword}</td>
                      <td>
                        {item.country}/{item.language}
                      </td>
                      <td>{item.popularity ?? "-"}</td>
                      <td>{item.rank ?? "-"}</td>
                      <td className={item.delta === null ? "" : item.delta > 0 ? "up" : item.delta < 0 ? "down" : "flat"}>
                        {item.delta === null ? "-" : item.delta > 0 ? `+${item.delta}` : item.delta}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="panel runsPanel">
        <h2>ASA Popularity (Latest)</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Locale</th>
                <th>Score</th>
                <th>Checked</th>
              </tr>
            </thead>
            <tbody>
              {latestPopularity.length === 0 ? (
                <tr>
                  <td colSpan={4}>No popularity data yet</td>
                </tr>
              ) : (
                latestPopularity.map((item) => (
                  <tr key={`${item.keywordId}-${item.localeId}`}>
                    <td>{item.keyword}</td>
                    <td>
                      {item.country}/{item.language}
                    </td>
                    <td>{item.popularityScore ?? "-"}</td>
                    <td>{formatTimestamp(item.checkedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel runsPanel">
        <h2>Recent Runs</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Targets</th>
                <th>Success</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No runs yet</td>
                </tr>
              ) : (
                runs.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>
                    <td>{item.status}</td>
                    <td>{item.totalTargets}</td>
                    <td>{item.successfulTargets}</td>
                    <td>{formatTimestamp(item.startedAt)}</td>
                    <td>{formatTimestamp(item.finishedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
