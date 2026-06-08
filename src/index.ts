#!/usr/bin/env node
// seo-performance MCP - entrypoint.
// All logging goes to stderr. stdout is reserved for JSON-RPC transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { listPostsTool, listPostsInputSchema } from "./tools/list-posts.js";
import { snapshotTool, snapshotInputSchema } from "./tools/snapshot.js";
import { decayCurveTool, decayCurveInputSchema } from "./tools/decay-curve.js";
import { verdictTool, verdictInputSchema } from "./tools/verdict.js";
import { refreshBriefTool, refreshBriefInputSchema } from "./tools/refresh-brief.js";
import { cohortReportTool, cohortReportInputSchema } from "./tools/cohort-report.js";
import { citeLossTool, citeLossInputSchema } from "./tools/cite-loss.js";
import { quickWinsTool, quickWinsInputSchema } from "./tools/quick-wins.js";
import { bingQuickWinsTool, bingQuickWinsInputSchema } from "./tools/bing-quick-wins.js";

import {
  listPostsOutputShape,
  snapshotOutputShape,
  decayCurveOutputShape,
  verdictOutputShape,
  refreshBriefOutputShape,
  cohortReportOutputShape,
  citeLossOutputShape,
  quickWinsOutputShape,
  bingQuickWinsOutputShape,
} from "./output-schemas.js";

import type { ToolError } from "./types.js";

const server = new McpServer({
  name: "@automatelab/seo-performance-mcp",
  version: "0.1.0",
});

type ToolResponse = {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function toolError(err: ToolError): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(err, null, 2) }],
    isError: true,
  };
}

function wrap<T>(handler: () => Promise<T>): Promise<ToolResponse> {
  return handler()
    .then((result): ToolResponse => ({
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    }))
    .catch((err: unknown): ToolResponse => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[error]", message);
      if (message.startsWith("Missing required env")) {
        return toolError({ type: "config_missing", message });
      }
      return toolError({ type: "internal", message });
    });
}

// Tool naming: dot-notation tree.
//   posts.*    - per-post analysis (list / snapshot / decay / verdict / refresh_brief / cite_loss)
//   cohort.*   - cross-post reports
//   gsc.*      - direct GSC scans (quick_wins)
//   bing.*     - direct Bing Webmaster Tools scans (quick_wins)

server.registerTool(
  "posts_list",
  {
    title: "List posts from any platform",
    description: [
      "Discover posts via an XML sitemap (POSTS_SITEMAP_URL or the sitemap_url arg), a JSON override list (POSTS_LIST), or - if configured - the Ghost Admin API. Pass an explicit urls[] to skip discovery entirely.",
      "Returns metadata: url, title, published_at, age_days, tags. Filter by minimum age or published-after date.",
      "When to use: discover which URLs are eligible for snapshot / verdict / cohort analysis. Works with any CMS that exposes a sitemap.",
    ].join("\n\n"),
    inputSchema: listPostsInputSchema.shape,
    outputSchema: listPostsOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (input) => wrap(() => listPostsTool(input)),
);

server.registerTool(
  "posts_snapshot",
  {
    title: "Unified per-URL snapshot",
    description: [
      "Pull a 30/60/90-day snapshot across every configured signal source for one post: GSC clicks/impressions/CTR/position + top queries, Matomo visits + dwell, GA4 pageviews, Clarity scroll/rage clicks, AI-citation counts.",
      "Each source is best-effort: if its env vars are missing the field is omitted. Returns whatever is available.",
      "Read-only. No third-party writes. Optionally persists to the local DuckDB cache when persist=true.",
    ].join("\n\n"),
    inputSchema: snapshotInputSchema.shape,
    outputSchema: snapshotOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (input) => wrap(() => snapshotTool(input)),
);

server.registerTool(
  "posts_decay_curve",
  {
    title: "Weekly GSC decay curve",
    description: [
      "Bucket GSC clicks/impressions/avg-position into ~weekly windows for the last N weeks (default 12) and classify the trend: decay / plateau / growth.",
      "Underpins the verdict engine's decay rules. Read-only GSC query.",
    ].join("\n\n"),
    inputSchema: decayCurveInputSchema.shape,
    outputSchema: decayCurveOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (input) => wrap(() => decayCurveTool(input)),
);

server.registerTool(
  "posts_verdict",
  {
    title: "Verdict per post (refresh / expand / merge / kill / double_down / hold)",
    description: [
      "Run the rule-based verdict engine on a single post: combine snapshot + decay curve and emit a verdict with reason codes and a 0-1 confidence score.",
      "Reason codes are deterministic. The mapping reasons -> verdict lives in src/verdict/rules.ts and can be inspected.",
      "Reporting only - does NOT mutate anything. To act on the verdict, hand the brief to a writer or to an AI rewrite tool.",
    ].join("\n\n"),
    inputSchema: verdictInputSchema.shape,
    outputSchema: verdictOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (input) => wrap(() => verdictTool(input)),
);

server.registerTool(
  "posts_refresh_brief",
  {
    title: "Refresh brief (markdown) per post",
    description: [
      "Produce a markdown brief for a human (or downstream LLM) editor: verdict + reasons + raw numbers + top queries + suggested actions.",
      "Use this as the hand-off artefact when verdict is refresh / expand / merge / double_down.",
    ].join("\n\n"),
    inputSchema: refreshBriefInputSchema.shape,
    outputSchema: refreshBriefOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (input) => wrap(() => refreshBriefTool(input)),
);

server.registerTool(
  "cohort_report",
  {
    title: "Cohort report across posts",
    description: [
      "Run the verdict engine across a cohort (filtered by tag and/or min-age) and return a ranked table sorted by verdict priority then confidence.",
      "Practical use: 'which three posts should I refresh this week?' - the top three rows with verdict=refresh and highest confidence are the answer.",
    ].join("\n\n"),
    inputSchema: cohortReportInputSchema.shape,
    outputSchema: cohortReportOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (input) => wrap(() => cohortReportTool(input)),
);

server.registerTool(
  "posts_cite_loss",
  {
    title: "AI-citation losses per URL",
    description: [
      "Return the list of LLMs that previously cited this URL but no longer do, with the prior query and last-seen date. Optionally includes the URL that replaced ours.",
      "Requires a configured citation-intelligence MCP endpoint (CITATION_INTELLIGENCE_URL). Otherwise returns an empty list.",
    ].join("\n\n"),
    inputSchema: citeLossInputSchema.shape,
    outputSchema: citeLossOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (input) => wrap(() => citeLossTool(input)),
);

server.registerTool(
  "gsc_quick_wins",
  {
    title: "GSC quick wins (positions 5-15)",
    description: [
      "Scan GSC for (page, query) pairs sitting in positions 5-15 with non-trivial impressions and a CTR below their position-expected curve. These are the fastest title-rewrite wins.",
      "Returns top results sorted by impressions desc. Pure GSC pull - platform-agnostic.",
    ].join("\n\n"),
    inputSchema: quickWinsInputSchema.shape,
    outputSchema: quickWinsOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (input) => wrap(() => quickWinsTool(input)),
);

server.registerTool(
  "bing_quick_wins",
  {
    title: "Bing quick wins (positions 5-15)",
    description: [
      "Scan Bing Webmaster Tools for queries sitting in positions 5-15 with non-trivial impressions. Bing's index backs Copilot, ChatGPT search, and Perplexity grounding, so a Bing rank gap is an LLM-citation gap.",
      "Query-level only: Bing has no single page+query API, so - unlike gsc_quick_wins, which returns (page, query) pairs - these carry no url. Sorted by impressions desc.",
      "Requires BING_WEBMASTER_API_KEY (Bing Webmaster Tools -> Settings -> API Access). Best-effort: returns config_missing if unset.",
    ].join("\n\n"),
    inputSchema: bingQuickWinsInputSchema.shape,
    outputSchema: bingQuickWinsOutputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (input) => wrap(() => bingQuickWinsTool(input)),
);

// Prompts: canned multi-tool workflows. Discoverable in any MCP client
// (Claude Desktop, Cursor, Continue, etc.) - no skill loader required.

server.registerPrompt(
  "audit_cohort",
  {
    title: "Audit a cohort of posts",
    description: "Run cohort_report on posts >=90 days old, then generate refresh briefs for every URL whose verdict is refresh / expand / merge.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Run the seo-performance MCP cohort audit:",
            "",
            "1. Call `cohort_report` with `min_age_days=90`, `window=30`, `limit=20`.",
            "2. For every row where verdict is one of refresh / expand / merge / double_down, call `posts_refresh_brief` on that URL.",
            "3. Output a single markdown digest, sorted by verdict priority then confidence, with the brief inlined per URL.",
            "4. At the end, recommend the top 3 URLs to act on this week.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.registerPrompt(
  "find_quick_wins",
  {
    title: "Find SERP quick wins",
    description: "Pull pages at positions 5-15 with low CTR and propose query-verbatim title/H1 rewrites.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Find SERP quick wins via the seo-performance MCP:",
            "",
            "1. Call `gsc_quick_wins` with `window=90`, `min_position=5`, `max_position=15`, `min_impressions=50`.",
            "2. Group by URL. For each URL with at least one query at 0% CTR, call `posts_snapshot` to confirm the top-query set.",
            "3. For each URL, suggest a meta_title and H1 rewrite that incorporates the exact phrasing of the highest-impression query verbatim (under 60 chars for the SERP title).",
            "4. Output a table: URL | top query | current position | current CTR | suggested meta_title.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.registerPrompt(
  "citation_loss_sweep",
  {
    title: "AI citation loss sweep",
    description: "Find URLs that lost LLM citations and generate refresh briefs targeted at recovering them.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Sweep for AI citation losses via the seo-performance MCP:",
            "",
            "1. Get a candidate URL list: either `posts_list` (limit 50) or an explicit `urls[]` you already have.",
            "2. For each URL, call `posts_cite_loss`. Keep only URLs with at least one entry in `losses[]`.",
            "3. For those URLs, call `posts_refresh_brief`.",
            "4. In the digest, highlight the lost-citation queries and recommend exact H1/first-paragraph phrasing that mirrors each lost query.",
          ].join("\n"),
        },
      },
    ],
  }),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[seo-performance-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
