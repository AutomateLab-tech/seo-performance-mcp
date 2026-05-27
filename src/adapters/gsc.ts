// Google Search Console adapter via the searchconsole/v1 API.
// Auth: service account JSON in GSC_SERVICE_ACCOUNT_JSON (raw or base64).
// Site: GSC_SITE_URL (sc-domain:example.com or https://example.com/).

import { google, type searchconsole_v1 } from "googleapis";
import { decodeJsonEnv, requireEnv } from "../config.js";
import type { GscMetrics } from "../types.js";

let cached: searchconsole_v1.Searchconsole | null = null;

function client(): searchconsole_v1.Searchconsole {
  if (cached) return cached;
  const creds = decodeJsonEnv<{ client_email: string; private_key: string }>(
    "GSC_SERVICE_ACCOUNT_JSON",
  );
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  cached = google.searchconsole({ version: "v1", auth });
  return cached;
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

  const byDate = new Map<string, { clicks: number; impressions: number; position: number; n: number }>();
  for (const row of res.data.rows ?? []) {
    const date = String(row.keys?.[0] ?? "");
    if (!date) continue;
    const weekStart = date.slice(0, 8) + String(Math.floor((parseInt(date.slice(8, 10), 10) - 1) / 7) * 7 + 1).padStart(2, "0");
    const bucket = byDate.get(weekStart) ?? { clicks: 0, impressions: 0, position: 0, n: 0 };
    bucket.clicks += row.clicks ?? 0;
    bucket.impressions += row.impressions ?? 0;
    bucket.position += row.position ?? 0;
    bucket.n += 1;
    byDate.set(weekStart, bucket);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, b]) => ({
      week_start,
      clicks: b.clicks,
      impressions: b.impressions,
      position: b.n > 0 ? b.position / b.n : 0,
    }));
}
