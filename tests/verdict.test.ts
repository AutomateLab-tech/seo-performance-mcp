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
  return { slug: "test", buckets, trend: "plateau", decay_pct: 0 };
}

function decayingDecay(): DecayCurve {
  // 16 weeks: first 8 at 30 clicks, last 8 at 5 clicks (drop of >50%).
  const buckets = [
    ...Array.from({ length: 8 }, (_, i) => bucket(16 - i, 30)),
    ...Array.from({ length: 8 }, (_, i) => bucket(8 - i, 5)),
  ];
  return { slug: "test", buckets, trend: "decay", decay_pct: -0.83 };
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

  it("returns hold with no reasons for a healthy plateauing post", () => {
    const v = decideVerdict(
      snap({ age_days: 400, clicks: 100, impressions: 800, ctr: 0.125, position: 5 }),
      flatDecay(),
    );
    expect(v.verdict).toBe("hold");
    expect(v.reasons.length).toBe(0);
  });
});
