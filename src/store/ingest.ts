// High-level orchestration: fetch from every adapter (best-effort) and assemble a Snapshot.
// Adapters that fail config-missing are simply skipped; their fields are left undefined.

import {
  fetchGscMetrics,
  fetchGscWeekly,
  detectCannibalization,
} from "../adapters/gsc.js";
import { fetchBingMetrics } from "../adapters/bing.js";
import { fetchMatomoMetrics } from "../adapters/matomo.js";
import { fetchGa4Metrics } from "../adapters/ga4.js";
import { fetchClarityMetrics } from "../adapters/clarity.js";
import { fetchCitationMetrics } from "../adapters/citation.js";
import { getPostMeta } from "../adapters/posts.js";
import type { Snapshot, DecayCurve, PostMeta } from "../types.js";

function pathFrom(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export async function buildSnapshot(url: string, windowDays: 30 | 60 | 90): Promise<Snapshot> {
  const meta = await getPostMeta(url);
  const path = pathFrom(url);

  const [gsc, bing, matomo, ga4, clarity, citations] = await Promise.all([
    safe(() => fetchGscMetrics({ url, window: windowDays })),
    safe(() => fetchBingMetrics(url, windowDays)),
    safe(() => fetchMatomoMetrics(url, windowDays)),
    safe(() => fetchGa4Metrics(path, windowDays)),
    safe(() => fetchClarityMetrics(path, windowDays)),
    safe(() => fetchCitationMetrics(url)),
  ]);

  const topQueryStrings = (gsc?.top_queries ?? []).map((q) => q.query).filter(Boolean);
  const cannibalization = await safe(() =>
    detectCannibalization(url, topQueryStrings, windowDays),
  );

  return {
    meta,
    window_days: windowDays,
    gsc: gsc ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, top_queries: [] },
    bing,
    matomo,
    ga4,
    clarity,
    citations,
    cannibalization: cannibalization && cannibalization.length > 0 ? cannibalization : undefined,
  };
}

export async function buildDecayCurve(url: string, weeks = 12): Promise<DecayCurve> {
  const buckets = await fetchGscWeekly(url, weeks);
  const decay30 = decayPct(buckets, 4);
  let trend: DecayCurve["trend"] = "plateau";
  if (decay30 < -0.15) trend = "decay";
  else if (decay30 > 0.15) trend = "growth";
  return {
    url,
    buckets,
    trend,
    decay_pct: round(decay30, 3),
  };
}

function decayPct(buckets: Array<{ clicks: number }>, weeks: number): number {
  const slice = buckets.slice(-weeks * 2);
  if (slice.length < weeks * 2) return 0;
  const earlier = slice.slice(0, weeks).reduce((s, b) => s + b.clicks, 0);
  const recent = slice.slice(weeks).reduce((s, b) => s + b.clicks, 0);
  if (earlier === 0) return 0;
  return (recent - earlier) / earlier;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export type { PostMeta };
