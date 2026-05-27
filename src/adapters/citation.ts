// Citation-intelligence adapter. Delegates to the @automatelab/citation-intelligence-mcp
// server via HTTP when CITATION_INTELLIGENCE_URL is set, otherwise returns empty results.
//
// The downstream MCP exposes domain_am_i_cited / citations_check tools; we wrap them to
// fit our CitationMetrics shape (active count + per-LLM loss list).

import { request } from "undici";
import { getEnv } from "../config.js";
import type { CitationMetrics } from "../types.js";

interface CitationCheckResponse {
  active: number;
  last_seen_at?: string;
  losses?: Array<{ llm: string; query: string; last_seen: string; replaced_by_url?: string }>;
}

export async function fetchCitationMetrics(pageUrl: string): Promise<CitationMetrics> {
  const endpoint = getEnv("CITATION_INTELLIGENCE_URL");
  if (!endpoint) {
    return { active_citations: 0, llms: [] };
  }
  try {
    const res = await request(`${endpoint.replace(/\/$/, "")}/citations/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: pageUrl }),
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { active_citations: 0, llms: [] };
    }
    const data = (await res.body.json()) as CitationCheckResponse;
    return {
      active_citations: data.active ?? 0,
      last_seen_at: data.last_seen_at,
      llms: data.losses ?? [],
    };
  } catch {
    return { active_citations: 0, llms: [] };
  }
}
