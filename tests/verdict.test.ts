import { describe, it, expect } from "vitest";
import { decideVerdict } from "../src/verdict/rules.js";
import type { Snapshot, DecayCurve } from "../src/types.js";

function bucket(week: number, clicks: number): { week_start: string; clicks: number; impressions: number; position: number } {
  const d = new Date(Date.now() - week * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { week_start: d, clicks, impressions: clicks * 20, position: 8 };
}

function snap(partial: Partial<Snapshot["meta"]> & Partial<Snapshot["gsc"]>): Snapshot {
  return {
    meta: {
      slug: "test",
      url: "https://example.com/test/",
      title: "Test",
      published_at: "2025-01-01",
      age_days: 400,
      status: "published",
      tags: [],
      word_count: 1500,
      ...partial,
    },
    window_days: 30,
    gsc: {
      clicks: 100,
      impressions: 1000,
      ctr: 0.1,
      position: 8,
      top_queries: [],
      ...partial,
    },
  };
}

function flatDecay(): DecayCurve {
  const buckets = Array.from({ length: 12 }, (_, i) => bucket(12 - i, 10));
  return { url: "https://example.com/test/", buckets, trend: "plateau", decay_pct: 0 };
}

function decayingDecay(): DecayCurve {
  // 16 weeks: first 8 at 30 clicks, last 8 at 5 clicks (drop of >50%).
  const buckets = [
    ...Array.from({ length: 8 }, (_, i) => bucket(16 - i, 30)),
    ...Array.from({ length: 8 }, (_, i) => bucket(8 - i, 5)),
  ];
  return { url: "https://example.com/test/", buckets, trend: "decay", decay_pct: -0.83 };
}

describe("decideVerdict", () => {
  it("returns hold for posts younger than 90 days", () => {
    const v = decideVerdict(snap({ age_days: 30 }), flatDecay());
    expect(v.verdict).toBe("hold");
    expect(v.reasons).toContain("fresh_post_too_young");
  });

  it("returns refresh for clear decay+ctr signal", () => {
    const v = decideVerdict(
      snap({ age_days: 400, clicks: 5, impressions: 5000, ctr: 0.001, position: 8 }),
      decayingDecay(),
    );
    expect(v.verdict).toBe("refresh");
    expect(v.reasons).toContain("decay_60d_over_50pct");
  });

  it("returns kill for stagnant_no_clicks", () => {
    const v = decideVerdict(
      snap({ age_days: 400, clicks: 0, impressions: 500, ctr: 0, position: 30 }),
      flatDecay(),
    );
    expect(v.verdict).toBe("kill");
    expect(v.reasons).toContain("stagnant_no_clicks");
  });

  it("returns double_down for citation growth", () => {
    const s = snap({ age_days: 400 });
    s.citations = { active_citations: 5, llms: [] };
    const v = decideVerdict(s, flatDecay());
    expect(v.verdict).toBe("double_down");
    expect(v.reasons).toContain("citation_growth");
  });

  it("a young post with a real CTR-below-expected signal returns refresh, not hold", () => {
    // Regression: previously the engine short-circuited on age_days < 90 and
    // returned hold even when the post had a clear actionable signal.
    const v = decideVerdict(
      snap({ age_days: 14, clicks: 10, impressions: 1990, ctr: 0.005, position: 6.4 }),
      flatDecay(),
    );
    expect(v.verdict).toBe("refresh");
    expect(v.reasons).toContain("ctr_below_position_expected");
    expect(v.reasons).toContain("fresh_post_too_young");
  });

  it("returns hold with no reasons for a healthy plateauing post", () => {
    const v = decideVerdict(
      snap({ age_days: 400, clicks: 100, impressions: 800, ctr: 0.125, position: 5 }),
      flatDecay(),
    );
    expect(v.verdict).toBe("hold");
    expect(v.reasons.length).toBe(0);
  });

  it("does not flag stagnant for a thin sample (sub-200 impressions)", () => {
    const v = decideVerdict(
      snap({ age_days: 400, clicks: 0, impressions: 51, ctr: 0, position: 30 }),
      flatDecay(),
    );
    expect(v.reasons).not.toContain("stagnant_no_clicks");
  });

  it("does not flag stagnant when the post is buried beyond position 50", () => {
    const v = decideVerdict(
      snap({ age_days: 400, clicks: 0, impressions: 500, ctr: 0, position: 75 }),
      flatDecay(),
    );
    expect(v.reasons).not.toContain("stagnant_no_clicks");
  });

  it("flags duplicate_or_cannibalizing and maps to merge", () => {
    const s = snap({ age_days: 400 });
    s.cannibalization = [
      { query: "test query", competing_urls: ["https://example.com/other/"] },
    ];
    const v = decideVerdict(s, flatDecay());
    expect(v.reasons).toContain("duplicate_or_cannibalizing");
    expect(v.verdict).toBe("merge");
  });

  it("high_bounce rule requires bounce + low scroll + low dwell together", () => {
    const bouncyButEngaged = snap({ age_days: 400 });
    bouncyButEngaged.matomo = {
      visits: 100,
      unique_visitors: 90,
      avg_time_on_page_s: 120,
      bounce_rate: 0.85,
    };
    bouncyButEngaged.clarity = {
      scroll_depth_avg: 0.8,
      rage_clicks: 0,
      dead_clicks: 0,
      excessive_scroll: 0,
    };
    expect(decideVerdict(bouncyButEngaged, flatDecay()).reasons).not.toContain(
      "high_bounce_low_scroll",
    );

    const allThree = snap({ age_days: 400 });
    allThree.matomo = {
      visits: 100,
      unique_visitors: 90,
      avg_time_on_page_s: 10,
      bounce_rate: 0.85,
    };
    allThree.clarity = {
      scroll_depth_avg: 0.15,
      rage_clicks: 0,
      dead_clicks: 0,
      excessive_scroll: 0,
    };
    expect(decideVerdict(allThree, flatDecay()).reasons).toContain(
      "high_bounce_low_scroll",
    );
  });

  it("uses an injected CTR curve over the default global curve", () => {
    // Site whose actual CTR at position 8 is 0.001 (way below the global 0.028).
    // With injection, an actual CTR of 0.0005 should NOT trip ctr_below (since
    // 0.0005 > 0.001 * 0.6 = 0.0006? actually 0.0005 < 0.0006, so it WOULD trip).
    // Use a curve where curve[8] = 0.0005 so a real CTR of 0.001 is well above 0.6 of expected.
    const curve = new Array(31).fill(0.0005);
    const v = decideVerdict(
      snap({ age_days: 400, clicks: 1, impressions: 2000, ctr: 0.001, position: 8 }),
      flatDecay(),
      { ctrCurve: curve },
    );
    expect(v.reasons).not.toContain("ctr_below_position_expected");

    // Same snap without curve injection trips the default rule.
    const vDefault = decideVerdict(
      snap({ age_days: 400, clicks: 1, impressions: 2000, ctr: 0.001, position: 8 }),
      flatDecay(),
    );
    expect(vDefault.reasons).toContain("ctr_below_position_expected");
  });

  it("confidence drops when reasons disagree on the target verdict", () => {
    const s = snap({ age_days: 400, clicks: 5, impressions: 5000, ctr: 0.001, position: 8 });
    s.citations = { active_citations: 5, llms: [] };
    const v = decideVerdict(s, decayingDecay());
    expect(v.reasons).toContain("citation_growth");
    expect(v.reasons).toContain("ctr_below_position_expected");

    const aligned = snap({ age_days: 400, clicks: 5, impressions: 5000, ctr: 0.001, position: 8 });
    const vAligned = decideVerdict(aligned, decayingDecay());

    expect(v.confidence).toBeLessThan(vAligned.confidence);
  });
});
