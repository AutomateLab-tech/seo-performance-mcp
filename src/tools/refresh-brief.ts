import { z } from "zod";
import { buildSnapshot, buildDecayCurve } from "../store/ingest.js";
import { decideVerdict } from "../verdict/rules.js";
import { REASON_STRINGS } from "../verdict/reasons.js";
import { fetchSiteCtrCurve } from "../adapters/gsc.js";

export const refreshBriefInputSchema = z.object({
  url: z.string().url().describe("Canonical URL of the post."),
  window: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().default(30),
});

export type RefreshBriefInput = z.infer<typeof refreshBriefInputSchema>;

export async function refreshBriefTool(input: RefreshBriefInput): Promise<{ markdown: string }> {
  const [snap, decay, ctrCurve] = await Promise.all([
    buildSnapshot(input.url, input.window),
    buildDecayCurve(input.url, 12),
    fetchSiteCtrCurve().catch(() => null),
  ]);
  const v = decideVerdict(snap, decay, { ctrCurve: ctrCurve ?? undefined });

  const lines: string[] = [];
  lines.push(`# Refresh brief: ${snap.meta.title}`);
  lines.push("");
  lines.push(`- URL: ${snap.meta.url}`);
  lines.push(`- Age: ${snap.meta.age_days} days`);
  lines.push(`- Verdict: **${v.verdict}** (confidence ${v.confidence})`);
  lines.push("");

  lines.push("## Why");
  if (v.reasons.length === 0) {
    lines.push("- No active reason codes. Hold for the next window.");
  } else {
    for (const r of v.reasons) {
      lines.push(`- ${REASON_STRINGS[r]}`);
    }
  }
  lines.push("");

  lines.push("## Numbers");
  lines.push(`- GSC: ${snap.gsc.clicks} clicks / ${snap.gsc.impressions} impressions / position ${snap.gsc.position.toFixed(1)} / CTR ${(snap.gsc.ctr * 100).toFixed(2)}%`);
  if (snap.matomo) {
    lines.push(`- Matomo: ${snap.matomo.visits} visits, avg time ${snap.matomo.avg_time_on_page_s.toFixed(0)}s, bounce ${(snap.matomo.bounce_rate * 100).toFixed(0)}%`);
  }
  if (snap.ga4) {
    lines.push(`- GA4: ${snap.ga4.visits} pageviews, ${snap.ga4.unique_visitors} users`);
  }
  if (snap.clarity) {
    lines.push(`- Clarity: scroll ${(snap.clarity.scroll_depth_avg * 100).toFixed(0)}%, rage ${snap.clarity.rage_clicks}, dead ${snap.clarity.dead_clicks}`);
  }
  if (snap.citations) {
    lines.push(`- Citations: ${snap.citations.active_citations} active${snap.citations.llms.length > 0 ? `, ${snap.citations.llms.length} lost` : ""}`);
  }
  lines.push(`- Decay trend: ${decay.trend} (${(decay.decay_pct * 100).toFixed(0)}%)`);
  lines.push("");

  lines.push("## Top queries (GSC)");
  for (const q of snap.gsc.top_queries.slice(0, 10)) {
    lines.push(`- "${q.query}" - ${q.clicks} clicks, pos ${q.position.toFixed(1)}`);
  }
  lines.push("");

  if (snap.cannibalization && snap.cannibalization.length > 0) {
    lines.push("## Competing URLs (cannibalization)");
    for (const c of snap.cannibalization.slice(0, 5)) {
      lines.push(`- "${c.query}" also ranks: ${c.competing_urls.slice(0, 3).join(", ")}`);
    }
    lines.push("");
  }

  if (snap.meta.headings && snap.meta.headings.length > 0) {
    lines.push("## Page structure (H1/H2)");
    for (const h of snap.meta.headings.slice(0, 15)) {
      lines.push(`- ${h}`);
    }
    lines.push("");
  }

  if (snap.meta.excerpt && snap.meta.excerpt.length > 0) {
    lines.push("## Page excerpt");
    lines.push("");
    lines.push(snap.meta.excerpt.slice(0, 2000));
    lines.push("");
    lines.push("> Compare the top queries above against this excerpt + the heading list to identify queries the page does not currently answer well.");
    lines.push("");
  }

  lines.push("## Suggested actions");
  for (const action of suggestActions(v.verdict, v.reasons)) {
    lines.push(`- ${action}`);
  }

  return { markdown: lines.join("\n") };
}

function suggestActions(verdict: string, reasons: string[]): string[] {
  const out: string[] = [];
  if (verdict === "refresh") {
    out.push("Rewrite the title and meta description; lead with the strongest top query.");
    out.push("Update any stat older than 12 months; add a current-year reference.");
    out.push("Add an FAQ section answering the top 3 GSC queries verbatim.");
  } else if (verdict === "expand") {
    out.push("Add a sub-section per top query that is not yet covered.");
    out.push("Embed one diagram or table to increase scannability.");
  } else if (verdict === "merge") {
    out.push("Identify the cannibalising URL (see 'Competing URLs' above); 301 the weaker post into the stronger one.");
  } else if (verdict === "double_down") {
    out.push("Plan 2-3 supporting cluster posts that internally link to this URL.");
    out.push("Pitch this URL to LLM-citation panels or syndicate widely.");
  } else if (verdict === "kill") {
    out.push("301 to the closest still-active topic, or noindex and remove from sitemap.");
  } else {
    out.push("No action. Re-check in 14 days.");
  }
  if (reasons.includes("citation_loss")) {
    out.push("Match the exact phrasing of the lost-citation query in the H1 or first paragraph.");
  }
  if (reasons.includes("duplicate_or_cannibalizing")) {
    out.push("Resolve overlap before any other action: pick the canonical URL for each shared query, 301 the loser, and dedupe internal links.");
  }
  return out;
}
