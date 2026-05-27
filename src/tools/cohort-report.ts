import { z } from "zod";
import { listPosts } from "../adapters/posts.js";
import { buildSnapshot, buildDecayCurve } from "../store/ingest.js";
import { decideVerdict } from "../verdict/rules.js";
import { fetchSiteCtrCurve } from "../adapters/gsc.js";

export const cohortReportInputSchema = z.object({
  urls: z.array(z.string().url()).optional().describe(
    "Explicit list of post URLs to include. Overrides sitemap discovery.",
  ),
  sitemap_url: z.string().url().optional().describe(
    "Sitemap URL to enumerate the cohort. Falls back to POSTS_SITEMAP_URL env var.",
  ),
  window: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().default(30),
  min_age_days: z.number().int().min(0).optional().default(90),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export type CohortReportInput = z.infer<typeof cohortReportInputSchema>;

export interface CohortRow {
  url: string;
  title: string;
  age_days: number;
  clicks: number;
  impressions: number;
  position: number;
  verdict: string;
  confidence: number;
  reasons: string[];
}

export async function cohortReportTool(input: CohortReportInput): Promise<{ rows: CohortRow[] }> {
  let urls: string[];

  if (input.urls && input.urls.length > 0) {
    urls = input.urls;
  } else {
    const posts = await listPosts({
      sitemapUrl: input.sitemap_url,
      minAgeDays: input.min_age_days,
      limit: input.limit,
    });
    urls = posts.map((p) => p.url);
  }

  const ctrCurve = await fetchSiteCtrCurve().catch(() => null);

  const rows: CohortRow[] = [];
  for (const url of urls) {
    try {
      const [snap, decay] = await Promise.all([
        buildSnapshot(url, input.window),
        buildDecayCurve(url, 12),
      ]);
      const v = decideVerdict(snap, decay, { ctrCurve: ctrCurve ?? undefined });
      rows.push({
        url: snap.meta.url,
        title: snap.meta.title,
        age_days: snap.meta.age_days,
        clicks: snap.gsc.clicks,
        impressions: snap.gsc.impressions,
        position: round(snap.gsc.position, 1),
        verdict: v.verdict,
        confidence: v.confidence,
        reasons: v.reasons,
      });
    } catch {
      // Skip URLs we can't snapshot; the report should still finish.
    }
  }

  rows.sort((a, b) => verdictPriority(a.verdict) - verdictPriority(b.verdict) || b.confidence - a.confidence);

  return { rows };
}

function verdictPriority(v: string): number {
  switch (v) {
    case "refresh": return 1;
    case "expand": return 2;
    case "merge": return 3;
    case "double_down": return 4;
    case "kill": return 5;
    case "hold": return 6;
    default: return 9;
  }
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
