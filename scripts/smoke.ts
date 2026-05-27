// Direct-call smoke test. Bypasses stdio; calls tool handlers in-process.
// Run: tsx scripts/smoke.ts
import { snapshotTool } from "../src/tools/snapshot.js";
import { decayCurveTool } from "../src/tools/decay-curve.js";
import { verdictTool } from "../src/tools/verdict.js";
import { refreshBriefTool } from "../src/tools/refresh-brief.js";
import { cohortReportTool } from "../src/tools/cohort-report.js";
import { quickWinsTool } from "../src/tools/quick-wins.js";

async function main(): Promise<void> {
  console.log("=== gsc.quick_wins (positions 5-15, 90d, min 10 impressions) ===");
  const qw = await quickWinsTool({ min_position: 5, max_position: 15, min_impressions: 10, window: 90, limit: 20 });
  console.log(JSON.stringify(qw.wins.slice(0, 10), null, 2));

  // Pull unique pages from quick wins and pick top 3 by impressions
  const byUrl = new Map<string, number>();
  for (const w of qw.wins) byUrl.set(w.url, (byUrl.get(w.url) ?? 0) + w.impressions);
  const targets = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([url]) => url);

  if (targets.length === 0) {
    console.log("\nNo pages with quick-win signal. Try a broader scan.");
    return;
  }

  for (const url of targets) {
    console.log(`\n========================================\n${url}\n========================================`);

    console.log("\n--- posts.snapshot (90d) ---");
    const snap = await snapshotTool({ url, window: 90, persist: false });
    console.log(JSON.stringify({
      title: snap.meta.title,
      age_days: snap.meta.age_days,
      gsc: { clicks: snap.gsc.clicks, impressions: snap.gsc.impressions, ctr: round(snap.gsc.ctr, 4), position: round(snap.gsc.position, 1) },
      top_queries: snap.gsc.top_queries.slice(0, 5),
    }, null, 2));

    console.log("\n--- posts.decay_curve (12 weeks) ---");
    const decay = await decayCurveTool({ url, weeks: 12 });
    console.log(JSON.stringify({ trend: decay.trend, decay_pct: decay.decay_pct, bucket_count: decay.buckets.length }, null, 2));

    console.log("\n--- posts.verdict ---");
    const v = await verdictTool({ url, window: 90, persist: false });
    console.log(JSON.stringify({ verdict: v.verdict, confidence: v.confidence, reasons: v.reasons }, null, 2));
  }

  console.log("\n========================================\ncohort.report (top 3 pages)\n========================================");
  const cohort = await cohortReportTool({ urls: targets, window: 90 });
  console.log(JSON.stringify(cohort.rows.map((r) => ({
    url: r.url, verdict: r.verdict, confidence: r.confidence, reasons: r.reasons, clicks: r.clicks, impressions: r.impressions, position: r.position,
  })), null, 2));

  console.log("\n========================================\nposts.refresh_brief (first target)\n========================================");
  const brief = await refreshBriefTool({ url: targets[0], window: 90 });
  console.log(brief.markdown);
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

main().catch((e) => {
  console.error("smoke test failed:", e);
  process.exit(1);
});
