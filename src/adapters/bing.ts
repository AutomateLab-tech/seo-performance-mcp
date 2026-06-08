// Bing Webmaster Tools adapter - search-performance parity with the GSC adapter.
//
// Auth: BING_WEBMASTER_API_KEY. Generate it in Bing Webmaster Tools ->
//   Settings -> API Access -> Generate API Key. One key per user covers all
//   verified sites. (A deployment that stores the key under another name can map
//   it onto BING_WEBMASTER_API_KEY in its launcher/env setup.)
// Site: BING_SITE_URL - the verified origin exactly as Bing stores it, with a
//   trailing slash (e.g. https://example.com/). Bing has no sc-domain: form;
//   when BING_SITE_URL is unset we derive the origin from GSC_SITE_URL.
//
// Transport: we call the POX (XML) endpoint, not JSON. The
//   /webmaster/api.svc/json/ route returns HTTP 503 from many networks (verified
//   here across curl + undici), while /webmaster/api.svc/pox/ serves the
//   identical data as XML. So we fetch XML and parse the flat <ArrayOfQueryStats>
//   shape ourselves (no XML dependency - the schema is flat and stable).
//
// BWT POX API (https://ssl.bing.com/webmaster/api.svc/pox/<Method>?apikey=...&siteUrl=...):
//   - A QueryStats row = { Query, Impressions, Clicks, AvgImpressionPosition,
//     AvgClickPosition, Date }. GetPageQueryStats adds a `page` param.
//   - Rows are a WEEKLY time series: one row per query per Date. We sum
//     clicks/impressions and impression-weight the position across the window.
//   - Bing exposes no CTR field; we derive ctr = clicks / impressions.
//   - Dates are ISO 8601 (e.g. "2026-05-22T00:00:00"). AvgClickPosition is -1
//     when a query had no clicks; we weight position by AvgImpressionPosition.

import { request } from "undici";
import { getEnv, requireEnv } from "../config.js";
import { urlVariants } from "./gsc.js";
import type { BingMetrics } from "../types.js";

const BWT_BASE = "https://ssl.bing.com/webmaster/api.svc/pox";

export interface QueryStatsRow {
  Query: string;
  Impressions: number;
  Clicks: number;
  AvgImpressionPosition: number;
  AvgClickPosition: number;
  Date: string;
}

// Bing's verified site has no sc-domain: form. Derive the https origin from
// BING_SITE_URL, else from GSC_SITE_URL (stripping the sc-domain: prefix).
function siteUrl(): string {
  const explicit = getEnv("BING_SITE_URL");
  if (explicit) return explicit;
  const gsc = getEnv("GSC_SITE_URL");
  if (gsc) {
    const host = gsc.startsWith("sc-domain:") ? gsc.slice("sc-domain:".length) : gsc;
    try {
      return new URL(host.includes("://") ? host : `https://${host}`).origin + "/";
    } catch {
      return `https://${host}/`;
    }
  }
  return requireEnv("BING_SITE_URL"); // throws a clear "Missing required env" message
}

// Decode the five predefined XML entities plus numeric character refs. &amp; is
// decoded last so an already-escaped "&amp;lt;" doesn't get double-decoded.
function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? decodeXml(m[1]) : "";
}

// Parse a flat POX <ArrayOfQueryStats><QueryStats>...</QueryStats>...</> body.
// Exported for tests (the network path needs a live BWT key). Query/Date text is
// XML-escaped on the wire, so any literal "</QueryStats>" inside a query is safe.
export function parseQueryStatsXml(xml: string): QueryStatsRow[] {
  const rows: QueryStatsRow[] = [];
  const re = /<QueryStats>([\s\S]*?)<\/QueryStats>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    rows.push({
      Query: tagText(b, "Query"),
      Impressions: Number(tagText(b, "Impressions")) || 0,
      Clicks: Number(tagText(b, "Clicks")) || 0,
      AvgImpressionPosition: Number(tagText(b, "AvgImpressionPosition")) || 0,
      AvgClickPosition: Number(tagText(b, "AvgClickPosition")) || 0,
      Date: tagText(b, "Date"),
    });
  }
  return rows;
}

// A plain client User-Agent. The BWT edge serves a 503 HTML page to browser-like
// and default tool UAs (Mozilla/*, curl/*) on the api.svc path; a distinct
// application UA is let through. Verified empirically against the live endpoint.
const BWT_UA = "seo-performance-mcp";

async function bwt(method: string, extra: Record<string, string> = {}): Promise<QueryStatsRow[]> {
  const apikey = requireEnv("BING_WEBMASTER_API_KEY");
  const params = new URLSearchParams({ apikey, siteUrl: siteUrl(), ...extra });
  const url = `${BWT_BASE}/${method}?${params.toString()}`;
  // The edge throws intermittent 503s; retry a couple of times with backoff.
  let lastCode = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await request(url, { headers: { accept: "application/xml", "user-agent": BWT_UA } });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return parseQueryStatsXml(await res.body.text());
    }
    await res.body.dump(); // release the connection before retrying
    lastCode = res.statusCode;
    if (lastCode !== 503 && lastCode !== 502 && lastCode !== 429) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`Bing Webmaster API ${method}: HTTP ${lastCode}`);
}

// Parse a BWT stat date to epoch ms. POX returns ISO 8601 ("2026-05-22T00:00:00");
// the legacy JSON endpoint returned ASP.NET "/Date(ms+-tz)/". Handle both.
export function parseStatDate(s: string): number {
  const m = /\/Date\((-?\d+)/.exec(s ?? "");
  if (m) return Number(m[1]);
  return Date.parse(s ?? ""); // NaN if unparseable
}

interface Agg {
  clicks: number;
  impressions: number;
  posWeighted: number;
}

// Collapse the weekly time series into one aggregate per Query, keeping only rows
// inside the window. Position is impression-weighted; a row with an unparseable
// Date is kept (best-effort) rather than dropped.
function aggregate(rows: QueryStatsRow[], sinceMs: number): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const r of rows) {
    const ms = parseStatDate(r.Date);
    if (Number.isFinite(ms) && ms < sinceMs) continue;
    const key = r.Query ?? "";
    const a = out.get(key) ?? { clicks: 0, impressions: 0, posWeighted: 0 };
    a.clicks += r.Clicks ?? 0;
    a.impressions += r.Impressions ?? 0;
    a.posWeighted += (r.AvgImpressionPosition ?? 0) * (r.Impressions ?? 0);
    out.set(key, a);
  }
  return out;
}

function positionOf(a: Agg): number {
  return a.impressions > 0 ? a.posWeighted / a.impressions : 0;
}
function ctrOf(a: Agg): number {
  return a.impressions > 0 ? a.clicks / a.impressions : 0;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// Pure core: collapse a query-level weekly time series into BingMetrics. Exported
// for tests (the network path can only be exercised with a live BWT key).
export function summarizeQueryRows(rows: QueryStatsRow[], sinceMs: number): BingMetrics {
  const byQuery = aggregate(rows, sinceMs);
  let totalClicks = 0;
  let totalImpr = 0;
  let posWeighted = 0;
  const top_queries = Array.from(byQuery.entries())
    .map(([query, a]) => {
      totalClicks += a.clicks;
      totalImpr += a.impressions;
      posWeighted += a.posWeighted;
      return {
        query,
        clicks: a.clicks,
        impressions: a.impressions,
        ctr: round4(ctrOf(a)),
        position: round1(positionOf(a)),
      };
    })
    .sort((x, y) => y.impressions - x.impressions)
    .slice(0, 10);

  return {
    clicks: totalClicks,
    impressions: totalImpr,
    ctr: totalImpr > 0 ? round4(totalClicks / totalImpr) : 0,
    position: totalImpr > 0 ? round1(posWeighted / totalImpr) : 0,
    top_queries,
  };
}

// Per-URL Bing metrics: totals + top queries for one page over the window.
// Mirrors fetchGscMetrics. Tries the canonical URL then the bare-slug variant
// (Bing, like GSC, may have filed the page under whichever form it first indexed).
export async function fetchBingMetrics(url: string, windowDays: number): Promise<BingMetrics> {
  const sinceMs = Date.now() - windowDays * 86_400_000;
  let rows: QueryStatsRow[] = [];
  for (const variant of urlVariants(url)) {
    rows = await bwt("GetPageQueryStats", { page: variant });
    if (rows.length > 0) break;
  }
  return summarizeQueryRows(rows, sinceMs);
}

export interface BingQuickWin {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

// Site-wide Bing quick wins: queries on the edge of page 1 (positions 5-15 by
// default) with real impressions. Bing has no single page+query call, so these
// are query-level (no page attached) - unlike gsc_quick_wins which returns pairs.
export async function bingQuickWins(opts: {
  minPosition: number;
  maxPosition: number;
  minImpressions: number;
  windowDays: number;
  limit: number;
}): Promise<BingQuickWin[]> {
  const sinceMs = Date.now() - opts.windowDays * 86_400_000;
  const rows = await bwt("GetQueryStats");
  const byQuery = aggregate(rows, sinceMs);
  return Array.from(byQuery.entries())
    .map(([query, a]) => ({
      query,
      impressions: a.impressions,
      clicks: a.clicks,
      ctr: round4(ctrOf(a)),
      position: round1(positionOf(a)),
    }))
    .filter(
      (r) =>
        r.position >= opts.minPosition &&
        r.position <= opts.maxPosition &&
        r.impressions >= opts.minImpressions,
    )
    .sort((x, y) => y.impressions - x.impressions)
    .slice(0, opts.limit);
}
