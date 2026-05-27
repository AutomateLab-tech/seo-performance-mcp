// Zod output schemas exposed to MCP clients via tool registration.
// Kept loose-but-explicit on purpose: dotted JSON-Schema shape from these zod types
// is what shows up in inspector tooling and Smithery validation.

import { z } from "zod";

export const postMetaShape = {
  slug: z.string(),
  url: z.string(),
  title: z.string(),
  published_at: z.string(),
  age_days: z.number(),
  status: z.string(),
  tags: z.array(z.string()),
};

export const listPostsOutputShape = {
  posts: z.array(z.object(postMetaShape)),
};

export const gscShape = {
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
  top_queries: z.array(
    z.object({
      query: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      ctr: z.number(),
      position: z.number(),
    }),
  ),
};

export const snapshotOutputShape = {
  meta: z.object(postMetaShape).extend({ updated_at: z.string().optional(), word_count: z.number().optional() }).passthrough(),
  window_days: z.number(),
  gsc: z.object(gscShape),
  matomo: z
    .object({
      visits: z.number(),
      unique_visitors: z.number(),
      avg_time_on_page_s: z.number(),
      bounce_rate: z.number(),
      goal_conversions: z.number().optional(),
    })
    .optional(),
  ga4: z
    .object({
      visits: z.number(),
      unique_visitors: z.number(),
      avg_time_on_page_s: z.number(),
      bounce_rate: z.number(),
    })
    .optional(),
  clarity: z
    .object({
      scroll_depth_avg: z.number(),
      rage_clicks: z.number(),
      dead_clicks: z.number(),
      excessive_scroll: z.number(),
    })
    .optional(),
  citations: z
    .object({
      active_citations: z.number(),
      last_seen_at: z.string().optional(),
      llms: z.array(
        z.object({
          llm: z.string(),
          query: z.string(),
          last_seen: z.string(),
          replaced_by_url: z.string().optional(),
        }),
      ),
    })
    .optional(),
};

export const decayCurveOutputShape = {
  slug: z.string(),
  buckets: z.array(
    z.object({
      week_start: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      position: z.number(),
    }),
  ),
  trend: z.enum(["decay", "plateau", "growth"]),
  decay_pct: z.number(),
};

export const verdictOutputShape = {
  slug: z.string(),
  verdict: z.enum(["refresh", "expand", "merge", "kill", "double_down", "hold"]),
  reasons: z.array(z.string()),
  confidence: z.number(),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.undefined()])),
  reason_strings: z.record(z.string(), z.string()),
};

export const refreshBriefOutputShape = { markdown: z.string() };

export const cohortReportOutputShape = {
  rows: z.array(
    z.object({
      slug: z.string(),
      url: z.string(),
      title: z.string(),
      age_days: z.number(),
      clicks: z.number(),
      impressions: z.number(),
      position: z.number(),
      verdict: z.string(),
      confidence: z.number(),
      reasons: z.array(z.string()),
    }),
  ),
};

export const citeLossOutputShape = {
  slug: z.string(),
  active: z.number(),
  losses: z.array(
    z.object({
      llm: z.string(),
      query: z.string(),
      last_seen: z.string(),
      replaced_by_url: z.string().optional(),
    }),
  ),
};

export const quickWinsOutputShape = {
  wins: z.array(
    z.object({
      url: z.string(),
      query: z.string(),
      impressions: z.number(),
      clicks: z.number(),
      ctr: z.number(),
      position: z.number(),
    }),
  ),
};
