// Matomo Reporting API adapter. Queries pageview/visit metrics per URL.

import { request } from "undici";
import { getEnv } from "../config.js";
import type { VisitMetrics } from "../types.js";

function base(): { url: string; token: string; idSite: string } {
  const url = getEnv("MATOMO_URL");
  const token = getEnv("MATOMO_TOKEN");
  const idSite = getEnv("MATOMO_SITE_ID");
  if (!url || !token || !idSite) {
    throw new Error("Missing Matomo env: MATOMO_URL / MATOMO_TOKEN / MATOMO_SITE_ID");
  }
  return { url: url.replace(/\/$/, ""), token, idSite };
}

function dateRange(days: 30 | 60 | 90): string {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return `${fmt(start)},${fmt(end)}`;
}

interface MatomoPageRow {
  label?: string;
  url?: string;
  nb_hits?: number;
  nb_visits?: number;
  nb_uniq_visitors?: number;
  avg_time_on_page?: number;
  bounce_rate?: string | number;
  nb_conversions?: number;
}

export async function fetchMatomoMetrics(
  pageUrl: string,
  windowDays: 30 | 60 | 90,
): Promise<VisitMetrics> {
  const { url, token, idSite } = base();
  const params = new URLSearchParams({
    module: "API",
    method: "Actions.getPageUrls",
    idSite,
    period: "range",
    date: dateRange(windowDays),
    format: "json",
    flat: "1",
    filter_limit: "-1",
    token_auth: token,
  });
  const res = await request(`${url}/?${params.toString()}`);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Matomo API ${res.statusCode}`);
  }
  const rows = (await res.body.json()) as MatomoPageRow[];

  const target = normalizePath(pageUrl);
  const match = rows.find((r) => normalizePath(r.url ?? r.label ?? "") === target);
  if (!match) {
    return {
      visits: 0,
      unique_visitors: 0,
      avg_time_on_page_s: 0,
      bounce_rate: 0,
      goal_conversions: 0,
    };
  }
  const bounce = typeof match.bounce_rate === "string"
    ? parseFloat(match.bounce_rate.replace("%", "")) / 100
    : match.bounce_rate ?? 0;
  return {
    visits: match.nb_visits ?? match.nb_hits ?? 0,
    unique_visitors: match.nb_uniq_visitors ?? 0,
    avg_time_on_page_s: match.avg_time_on_page ?? 0,
    bounce_rate: Number.isFinite(bounce) ? bounce : 0,
    goal_conversions: match.nb_conversions ?? 0,
  };
}

function normalizePath(u: string): string {
  try {
    const parsed = new URL(u, "https://placeholder.example/");
    return parsed.pathname.replace(/\/$/, "") || "/";
  } catch {
    return u.replace(/\/$/, "") || "/";
  }
}
