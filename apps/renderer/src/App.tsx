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

type Summary = {
  apps: number;
  keywords: number;
  locales: number;
  targets: number;
  lastRun: { id: number; status: string; startedAt: string; finishedAt: string | null } | null;
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

export default function App() {
  const [health, setHealth] = useState<string>("checking...");
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [keywords, setKeywords] = useState<KeywordRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string>("");

  const [appName, setAppName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [term, setTerm] = useState("");

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
      const [healthRes, appsRes, keywordsRes, summaryRes] = await Promise.all([
        api<{ ok: boolean }>("/health"),
        api<AppRecord[]>("/apps"),
        api<KeywordRecord[]>("/keywords"),
        api<Summary>("/dashboard/summary")
      ]);

      setHealth(healthRes.ok ? "online" : "offline");
      setApps(appsRes);
      setKeywords(keywordsRes);
      setSummary(summaryRes);
    } catch (e) {
      setHealth("offline");
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  useEffect(() => {
    refreshAll();
  }, []);

  async function onAddApp(e: FormEvent) {
    e.preventDefault();
    if (!appName || !storeId) {
      return;
    }

    await api<{ id: number }>("/apps", {
      method: "POST",
      body: JSON.stringify({ name: appName, storeId, platform: "ios" })
    });

    setAppName("");
    setStoreId("");
    refreshAll();
  }

  async function onAddKeyword(e: FormEvent) {
    e.preventDefault();
    if (!term) {
      return;
    }

    await api<{ id: number }>("/keywords", {
      method: "POST",
      body: JSON.stringify({ term })
    });

    setTerm("");
    refreshAll();
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

      <section className="cards">
        {counts.map(([label, value]) => (
          <article className="card" key={String(label)}>
            <span>{label}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Add App</h2>
          <form onSubmit={onAddApp}>
            <input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="App name"
              required
            />
            <input
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="App Store ID"
              required
            />
            <button type="submit">Save App</button>
          </form>

          <ul>
            {apps.map((item) => (
              <li key={item.id}>
                <span>{item.name}</span>
                <small>{item.storeId}</small>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Add Keyword</h2>
          <form onSubmit={onAddKeyword}>
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Keyword" required />
            <button type="submit">Save Keyword</button>
          </form>

          <ul>
            {keywords.map((item) => (
              <li key={item.id}>
                <span>{item.term}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
