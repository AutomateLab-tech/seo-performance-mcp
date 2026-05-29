// Google Search Console adapter via the searchconsole/v1 API.
// Auth (priority order):
//   1. GSC_SERVICE_ACCOUNT_JSON  - service account JSON (raw or base64)
//   2. GOOGLE_APPLICATION_CREDENTIALS - path to a JSON file (service account or authorized_user)
// Site: GSC_SITE_URL (sc-domain:example.com or https://example.com/).

import { readFileSync } from "node:fs";
import { google, type searchconsole_v1 } from "googleapis";
import { JWT, UserRefreshClient } from "google-auth-library";
import { decodeJsonEnv, getEnv, requireEnv } from "../config.js";
import type { GscMetrics, CannibalizationHit } from "../types.js";

let cached: searchconsole_v1.Searchconsole | null = null;

function client(): searchconsole_v1.Searchconsole {
  if (cached) return cached;
  cached = google.searchconsole({ version: "v1", auth: buildAuth() });
  return cached;
}

function buildAuth(): JWT | UserRefreshClient {
  const scopes = ["https://www.googleapis.com/auth/webmasters.readonly"];

  if (getEnv("GSC_SERVICE_ACCOUNT_JSON")) {
    const creds = decodeJsonEnv<{ client_email: string; private_key: string }>(
      "GSC_SERVICE_ACCOUNT_JSON",
    );
    return new JWT({ email: creds.client_email, key: creds.private_key, scopes });
  }

  const path = getEnv("GOOGLE_APPLICATION_CREDENTIALS");
  if (path) {
    const text = readFileSync(path, "utf-8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.type === "authorized_user") {
      return new UserRefreshClient(
        parsed.client_id as string,
        parsed.client_secret as string,
        parsed.refresh_token as string,
      );
    }
    if (parsed.type === "service_account" || parsed.client_email) {
      return new JWT({
        email: parsed.client_email as string,
        key: parsed.private_key as string,
        scopes,
      });
    }
    throw new Error(`Unrecognised credential type in ${path}`);
  }

  throw new Error("Missing GSC auth: set GSC_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS");
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export interface GscQueryOptions {
  url: string;
  window: 30 | 60 | 90;
  topQueriesLimit?: number;
}

export async function fetchGscMetrics(opts: GscQueryOptions): Promise<GscMetrics> {
  const siteUrl = requireEnv("GSC_SITE_URL");
  const sc = client();
  const startDate = daysAgo(opts.window);
  const endDate = daysAgo(1);

  const totalsRes = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: [],
      dimensionFilterGroups: [
        {
          filters: [{ dimension: "page", operator: "equals", expression: opts.url }],
        },
      ],
      rowLimit: 1,
    },
  });
  const totalRow = totalsRes.data.rows?.[0];
  const totals = {
    clicks: totalRow?.clicks ?? 0,
    impressions: totalRow?.impressions ?? 0,
    ctr: totalRow?.ctr ?? 0,
    position: totalRow?.position ?? 0,
  };

  const queriesRes = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["query"],
      dimensionFilterGroups: [
        {
          filters: [{ dimension: "page", operator: "equals", expression: opts.url }],
        },
      ],
      rowLimit: opts.topQueriesLimit ?? 10,
    },
  });
  const top_queries = (queriesRes.data.rows ?? []).map((r) => ({
    query: String(r.keys?.[0] ?? ""),
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));

  return { ...totals, top_queries };
}

export async function fetchGscWeekly(
  url: string,
  weeks: number,
): Promise<Array<{ week_start: string; clicks: number; impressions: number; position: number }>> {
  const siteUrl = requireEnv("GSC_SITE_URL");
  const sc = client();
  const startDate = daysAgo(weeks * 7);
  const endDate = daysAgo(1);

  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["date"],
      dimensionFilterGroups: [
        {
          filters: [{ dimension: "page", operator: "equals", expression: url }],
        },
      ],
      rowLimit: weeks * 7 + 5,
    },
  });

  const rows = (res.data.rows ?? [])
    .map((r) => ({
      date: String(r.keys?.[0] ?? ""),
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      position: r.position ?? 0,
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (rows.length === 0) return [];

  const firstMs = Date.parse(rows[0].date + "T00:00:00Z");
  const buckets = new Map<string, { clicks: number; impressions: number; position: number; n: number }>();
  for (const r of rows) {
    const ms = Date.parse(r.date + "T00:00:00Z");
    const dayOffset = Math.floor((ms - firstMs) / 86_400_000);
    const weekIdx = Math.floor(dayOffset / 7);
    const weekStartMs = firstMs + weekIdx * 7 * 86_400_000;
    const key = new Date(weekStartMs).toISOString().slice(0, 10);
    const b = buckets.get(key) ?? { clicks: 0, impressions: 0, position: 0, n: 0 };
    b.clicks += r.clicks;
    b.impressions += r.impressions;
    b.position += r.position;
    b.n += 1;
    buckets.set(key, b);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, b]) => ({
      week_start,
      clicks: b.clicks,
      impressions: b.impressions,
      position: b.n > 0 ? b.position / b.n : 0,
    }));
}

let ctrCurveCache: { curve: number[]; at: number } | null = null;
const CTR_CURVE_TTL_MS = 24 * 60 * 60 * 1000;
const CTR_CURVE_MAX_POSITION = 30;

export async function fetchSiteCtrCurve(): Promise<number[] | null> {
  if (ctrCurveCache && Date.now() - ctrCurveCache.at < CTR_CURVE_TTL_MS) {
    return ctrCurveCache.curve;
  }
  const siteUrl = requireEnv("GSC_SITE_URL");
  const sc = client();
  const startDate = daysAgo(90);
  const endDate = daysAgo(1);

  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["query", "page"],
      rowLimit: 25000,
    },
  });

  const bins = Array.from({ length: CTR_CURVE_MAX_POSITION + 1 }, () => ({
    clicks: 0,
    impressions: 0,
  }));
  for (const row of res.data.rows ?? []) {
    const pos = Math.round(row.position ?? 0);
    if (pos < 1 || pos > CTR_CURVE_MAX_POSITION) continue;
    bins[pos].clicks += row.clicks ?? 0;
    bins[pos].impressions += row.impressions ?? 0;
  }

  const minSampleImpr = 100;
  const curve = bins.map((b) => (b.impressions >= minSampleImpr ? b.clicks / b.impressions : NaN));
  const validCount = curve.filter((c) => !Number.isNaN(c)).length;
  if (validCount < 5) return null;

  for (let i = 0; i < curve.length; i++) {
    if (!Number.isNaN(curve[i])) continue;
    let prev = -1;
    let next = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (!Number.isNaN(curve[j])) {
        prev = j;
        break;
      }
    }
    for (let j = i + 1; j < curve.length; j++) {
      if (!Number.isNaN(curve[j])) {
        next = j;
        break;
      }
    }
    if (prev >= 0 && next >= 0) curve[i] = (curve[prev] + curve[next]) / 2;
    else if (prev >= 0) curve[i] = curve[prev];
    else if (next >= 0) curve[i] = curve[next];
    else curve[i] = 0;
  }

  ctrCurveCache = { curve, at: Date.now() };
  return curve;
}

export async function detectCannibalization(
  url: string,
  topQueries: string[],
  windowDays: number,
): Promise<CannibalizationHit[]> {
  if (topQueries.length === 0) return [];
  const siteUrl = requireEnv("GSC_SITE_URL");
  const sc = client();
  const startDate = daysAgo(windowDays);
  const endDate = daysAgo(1);

  const queries = topQueries.slice(0, 5);
  const filters = queries.map((q) => ({
    dimension: "query",
    operator: "equals",
    expression: q,
  }));

  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["query", "page"],
      dimensionFilterGroups: [{ groupType: "or", filters }],
      rowLimit: 500,
    },
  });

  const competing = new Map<string, Set<string>>();
  for (const row of res.data.rows ?? []) {
    const q = String(row.keys?.[0] ?? "");
    const p = String(row.keys?.[1] ?? "");
    if (!q || !p || p === url) continue;
    if ((row.impressions ?? 0) < 10) continue;
    const set = competing.get(q) ?? new Set<string>();
    set.add(p);
    competing.set(q, set);
  }

  return Array.from(competing.entries())
    .filter(([, urls]) => urls.size > 0)
    .map(([query, urls]) => ({ query, competing_urls: Array.from(urls) }));
}

// Slug variants for a canonical URL. Some platforms (Bing Webmaster Tools, and
// occasionally GSC) file a page under its bare last-segment slug rather than its
// full canonical path. Yields the canonical URL plus that bare-slug form so a
// caller can try both. Used by the Bing adapter.
export function urlVariants(url: string): string[] {
  const set = new Set<string>([url]);
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length > 1) {
      const bare = `${u.origin}/${segments[segments.length - 1]}/`;
      set.add(bare);
    }
  } catch {
    // Non-parseable URL: skip the variant.
  }
  return Array.from(set);
}
