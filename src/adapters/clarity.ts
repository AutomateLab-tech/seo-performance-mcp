// Microsoft Clarity Data Export API adapter. Returns scroll-depth and rage/dead-click signals.
// Clarity's Data Export API is project-scoped and rate-limited (10 calls per project per day).

import { request } from "undici";
import { getEnv } from "../config.js";
import type { BehaviorMetrics } from "../types.js";

function base(): { projectId: string; token: string } {
  const projectId = getEnv("CLARITY_PROJECT_ID");
  const token = getEnv("CLARITY_API_TOKEN");
  if (!projectId || !token) {
    throw new Error("Missing Clarity env: CLARITY_PROJECT_ID / CLARITY_API_TOKEN");
  }
  return { projectId, token };
}

interface ClarityMetric {
  metricName: string;
  information: Array<Record<string, string | number>>;
}

export async function fetchClarityMetrics(
  pagePath: string,
  windowDays: 30 | 60 | 90,
): Promise<BehaviorMetrics> {
  const { projectId, token } = base();
  const numOfDays = Math.min(3, windowDays);

  const params = new URLSearchParams({
    numOfDays: String(numOfDays),
    dimension1: "URL",
  });
  const url = `https://www.clarity.ms/export-data/api/v1/project-live-insights?${params.toString()}`;
  const res = await request(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Project-Id": projectId,
    },
  });
  if (res.statusCode === 429) {
    return blankBehavior();
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    return blankBehavior();
  }
  const data = (await res.body.json()) as ClarityMetric[];

  const findFor = (metricName: string): number => {
    const m = data.find((d) => d.metricName === metricName);
    if (!m) return 0;
    const row = m.information.find((r) =>
      String(r.URL ?? r.Url ?? r.url ?? "").endsWith(pagePath),
    );
    const v = row?.PagesPerSession ?? row?.SessionsCount ?? row?.value ?? 0;
    return typeof v === "number" ? v : parseFloat(String(v)) || 0;
  };

  return {
    scroll_depth_avg: findFor("ScrollDepth"),
    rage_clicks: findFor("RageClickCount"),
    dead_clicks: findFor("DeadClickCount"),
    excessive_scroll: findFor("ExcessiveScroll"),
  };
}

function blankBehavior(): BehaviorMetrics {
  return { scroll_depth_avg: 0, rage_clicks: 0, dead_clicks: 0, excessive_scroll: 0 };
}
