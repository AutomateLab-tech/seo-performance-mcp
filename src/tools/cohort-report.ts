import { z } from "zod";
import { listPosts } from "../adapters/ghost.js";
import { buildSnapshot, buildDecayCurve } from "../store/ingest.js";
import { decideVerdict } from "../verdict/rules.js";

export const cohortReportInputSchema = z.object({
  window: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().default(30),
  tag: z.string().optional(),
  min_age_days: z.number().int().min(0).optional().default(90),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export type CohortReportInput = z.infer<typeof cohortReportInputSchema>;

export interface CohortRow {
  slug: string;
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
  const posts = await listPosts({
    tag: input.tag,
    minAgeDays: input.min_age_days,
    limit: input.limit,
  });

  const rows: CohortRow[] = [];
  for (const post of posts) {
    try {
      const [snap, decay] = await Promise.all([
        buildSnapshot(post.slug, input.window),
        buildDecayCurve(post.slug, 12),
      ]);
      const v = decideVerdict(snap, decay);
      rows.push({
        slug: post.slug,
        url: post.url,
        title: post.title,
        age_days: post.age_days,
        clicks: snap.gsc.clicks,
        impressions: snap.gsc.impressions,
        position: round(snap.gsc.position, 1),
        verdict: v.verdict,
        confidence: v.confidence,
        reasons: v.reasons,
      });
    } catch {
      // Skip posts we can't snapshot; the report should still finish.
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
