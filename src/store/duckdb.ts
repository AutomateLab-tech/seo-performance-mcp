// Lightweight DuckDB-backed cache for cross-tool reuse: snapshots, decay buckets, verdicts.
// File path is set via SPM_DB_PATH (default ./.duckdb/spm.duckdb).

import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "duckdb-async";
import { getEnv } from "../config.js";

let dbInstance: Database | null = null;

async function ensure(): Promise<Database> {
  if (dbInstance) return dbInstance;
  const path = getEnv("SPM_DB_PATH") ?? "./.duckdb/spm.duckdb";
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }
  dbInstance = await Database.create(path);
  await dbInstance.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      url TEXT,
      window_days INTEGER,
      taken_at TIMESTAMP DEFAULT now(),
      payload JSON,
      PRIMARY KEY (url, window_days, taken_at)
    );
    CREATE TABLE IF NOT EXISTS verdicts (
      url TEXT,
      taken_at TIMESTAMP DEFAULT now(),
      verdict TEXT,
      reasons JSON,
      confidence DOUBLE,
      PRIMARY KEY (url, taken_at)
    );
  `);
  return dbInstance;
}

export async function saveSnapshot(url: string, windowDays: number, payload: unknown): Promise<void> {
  const db = await ensure();
  await db.run(
    "INSERT INTO snapshots (url, window_days, payload) VALUES (?, ?, ?)",
    url,
    windowDays,
    JSON.stringify(payload),
  );
}

export async function saveVerdict(
  url: string,
  verdict: string,
  reasons: string[],
  confidence: number,
): Promise<void> {
  const db = await ensure();
  await db.run(
    "INSERT INTO verdicts (url, verdict, reasons, confidence) VALUES (?, ?, ?, ?)",
    url,
    verdict,
    JSON.stringify(reasons),
    confidence,
  );
}

export async function close(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}
