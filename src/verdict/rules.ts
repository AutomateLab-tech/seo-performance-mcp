// Rule-based verdict engine. Pure function: given a Snapshot + DecayCurve, returns a Verdict.
// All thresholds live here so the test suite can pin them.

import type { Snapshot, DecayCurve, Verdict, ReasonCode, VerdictKind } from "../types.js";

const THRESHOLDS = {
  freshPostDays: 90,
  decay30Pct: 0.3,
  decay60Pct: 0.5,
  positionDrift: 3,
  thinContentWords: 500,
  thinContentDwellS: 30,
  highBounce: 0.75,
  lowScrollDepth: 0.3,
  lowCtrRisingImpressions: 0.01,
  growthClicksMin: 5,
};

function expectedCtr(position: number): number {
  // Crude monotonic decay curve from common SERP CTR distributions. Tunable.
  if (position <= 0) return 0;
  const map: Array<[number, number]> = [
    [1, 0.27], [2, 0.16], [3, 0.11], [4, 0.08], [5, 0.06],
    [6, 0.045], [7, 0.035], [8, 0.028], [9, 0.024], [10, 0.02],
  ];
  for (const [pos, ctr] of map) {
    if (position <= pos) return ctr;
  }
  if (position <= 20) return 0.012;
  return 0.005;
}

function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return (a - b) / b;
}

export function decideVerdict(snap: Snapshot, decay: DecayCurve): Verdict {
  const reasons: ReasonCode[] = [];
  const evidence: Record<string, number | string | undefined> = {};
  const meta = snap.meta;
  const gsc = snap.gsc;

  if (meta.age_days < THRESHOLDS.freshPostDays) {
    reasons.push("fresh_post_too_young");
    evidence["age_days"] = meta.age_days;
    return {
      slug: meta.slug,
      verdict: "hold",
      reasons,
      confidence: 0.9,
      evidence,
    };
  }

  if (gsc.clicks === 0 && gsc.impressions > 50) {
    reasons.push("stagnant_no_clicks");
    evidence["impressions"] = gsc.impressions;
  }

  const expCtr = expectedCtr(gsc.position);
  if (gsc.impressions > 100 && gsc.ctr < expCtr * 0.6) {
    reasons.push("ctr_below_position_expected");
    evidence["ctr"] = round(gsc.ctr, 4);
    evidence["expected_ctr"] = round(expCtr, 4);
    evidence["position"] = round(gsc.position, 1);
  }

  const decay30 = recentDecay(decay, 4);
  const decay60 = recentDecay(decay, 8);
  if (decay30 < -THRESHOLDS.decay30Pct) {
    reasons.push("decay_30d_over_30pct");
    evidence["decay_30d"] = round(decay30, 3);
  }
  if (decay60 < -THRESHOLDS.decay60Pct) {
    reasons.push("decay_60d_over_50pct");
    evidence["decay_60d"] = round(decay60, 3);
  }

  if (snap.baseline) {
    const drift = gsc.position - snap.baseline.position;
    if (Math.abs(drift) > THRESHOLDS.positionDrift) {
      reasons.push("position_drift");
      evidence["position_drift"] = round(drift, 1);
    }
  }

  const matomo = snap.matomo ?? snap.ga4;
  if (matomo) {
    if (
      (meta.word_count ?? 0) > 0 &&
      meta.word_count! < THRESHOLDS.thinContentWords &&
      matomo.avg_time_on_page_s < THRESHOLDS.thinContentDwellS
    ) {
      reasons.push("thin_content_low_dwell");
      evidence["word_count"] = meta.word_count;
      evidence["avg_time_on_page_s"] = round(matomo.avg_time_on_page_s, 1);
    }
    if (matomo.bounce_rate >= THRESHOLDS.highBounce) {
      const scroll = snap.clarity?.scroll_depth_avg ?? 1;
      if (scroll < THRESHOLDS.lowScrollDepth) {
        reasons.push("high_bounce_low_scroll");
        evidence["bounce_rate"] = round(matomo.bounce_rate, 3);
        evidence["scroll_depth_avg"] = round(scroll, 3);
      }
    }
  }

  const clicksGrowth = recentDecay(decay, 4) * -1;
  if (gsc.impressions > 200 && gsc.ctr < THRESHOLDS.lowCtrRisingImpressions && clicksGrowth < 0.05) {
    reasons.push("rising_impressions_low_ctr");
    evidence["impressions"] = gsc.impressions;
    evidence["ctr"] = round(gsc.ctr, 4);
  }
  if (clicksGrowth > 0.2 && gsc.clicks > THRESHOLDS.growthClicksMin) {
    reasons.push("rising_clicks_continue_investment");
    evidence["clicks_growth"] = round(clicksGrowth, 3);
  }

  if (snap.citations) {
    if ((snap.citations.llms?.length ?? 0) > 0 && snap.citations.active_citations === 0) {
      reasons.push("citation_loss");
      evidence["lost_citations"] = snap.citations.llms.length;
    } else if (snap.citations.active_citations >= 2) {
      reasons.push("citation_growth");
      evidence["active_citations"] = snap.citations.active_citations;
    }
  }

  const verdict = mapReasonsToVerdict(reasons);
  const confidence = confidenceFor(reasons, snap, decay);
  return {
    slug: meta.slug,
    verdict,
    reasons,
    confidence,
    evidence,
  };
}

function mapReasonsToVerdict(reasons: ReasonCode[]): VerdictKind {
  const set = new Set(reasons);
  if (set.has("rising_clicks_continue_investment") || set.has("citation_growth")) return "double_down";
  if (set.has("stagnant_no_clicks")) return "kill";
  if (set.has("duplicate_or_cannibalizing")) return "merge";
  if (set.has("decay_60d_over_50pct") || set.has("citation_loss")) return "refresh";
  if (set.has("decay_30d_over_30pct") && set.has("ctr_below_position_expected")) return "refresh";
  if (set.has("ctr_below_position_expected") || set.has("rising_impressions_low_ctr")) return "refresh";
  if (set.has("thin_content_low_dwell")) return "expand";
  if (set.size === 0) return "hold";
  return "hold";
}

function confidenceFor(reasons: ReasonCode[], snap: Snapshot, decay: DecayCurve): number {
  const sampleSize = snap.gsc.impressions + (snap.matomo?.visits ?? snap.ga4?.visits ?? 0);
  const sampleWeight = Math.min(1, sampleSize / 500);
  const reasonWeight = Math.min(1, reasons.length / 3);
  const windowWeight = Math.min(1, decay.buckets.length / 8);
  return round(0.4 * sampleWeight + 0.3 * reasonWeight + 0.3 * windowWeight, 2);
}

function recentDecay(decay: DecayCurve, weeks: number): number {
  const buckets = decay.buckets.slice(-weeks * 2);
  if (buckets.length < weeks * 2) return 0;
  const earlier = buckets.slice(0, weeks).reduce((s, b) => s + b.clicks, 0);
  const recent = buckets.slice(weeks).reduce((s, b) => s + b.clicks, 0);
  return pct(recent, earlier);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
