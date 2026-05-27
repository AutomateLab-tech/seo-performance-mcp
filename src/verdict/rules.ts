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
  lowDwellS: 30,
  lowCtrRisingImpressions: 0.01,
  growthClicksMin: 5,
  stagnantImpressionsMin: 200,
  stagnantMaxPosition: 50,
};

const DEFAULT_CTR_CURVE: Array<[number, number]> = [
  [1, 0.27], [2, 0.16], [3, 0.11], [4, 0.08], [5, 0.06],
  [6, 0.045], [7, 0.035], [8, 0.028], [9, 0.024], [10, 0.02],
];

function expectedCtr(position: number, curve?: number[]): number {
  if (position <= 0) return 0;
  if (curve && curve.length > 1) {
    const idx = Math.min(curve.length - 1, Math.max(1, Math.round(position)));
    const c = curve[idx];
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
  }
  for (const [pos, ctr] of DEFAULT_CTR_CURVE) {
    if (position <= pos) return ctr;
  }
  if (position <= 20) return 0.012;
  return 0.005;
}

function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return (a - b) / b;
}

export interface VerdictOptions {
  ctrCurve?: number[];
}

export function decideVerdict(snap: Snapshot, decay: DecayCurve, opts: VerdictOptions = {}): Verdict {
  const reasons: ReasonCode[] = [];
  const evidence: Record<string, number | string | undefined> = {};
  const meta = snap.meta;
  const gsc = snap.gsc;

  // Mark young posts but do not short-circuit. Decay rules already self-guard
  // (recentDecay returns 0 when buckets are missing); CTR / stagnation / growth
  // rules are age-agnostic and should still fire on posts with real GSC data.
  // mapReasonsToVerdict ignores fresh_post_too_young unless no other signal fires.
  if (meta.age_days < THRESHOLDS.freshPostDays) {
    reasons.push("fresh_post_too_young");
    evidence["age_days"] = meta.age_days;
  }

  if (
    gsc.clicks === 0 &&
    gsc.impressions >= THRESHOLDS.stagnantImpressionsMin &&
    gsc.position > 0 &&
    gsc.position <= THRESHOLDS.stagnantMaxPosition
  ) {
    reasons.push("stagnant_no_clicks");
    evidence["impressions"] = gsc.impressions;
    evidence["position"] = round(gsc.position, 1);
  }

  const expCtr = expectedCtr(gsc.position, opts.ctrCurve);
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

  const visits = snap.matomo ?? snap.ga4;
  if (visits) {
    if (
      (meta.word_count ?? 0) > 0 &&
      meta.word_count! < THRESHOLDS.thinContentWords &&
      visits.avg_time_on_page_s < THRESHOLDS.thinContentDwellS
    ) {
      reasons.push("thin_content_low_dwell");
      evidence["word_count"] = meta.word_count;
      evidence["avg_time_on_page_s"] = round(visits.avg_time_on_page_s, 1);
    }
    if (
      visits.bounce_rate >= THRESHOLDS.highBounce &&
      visits.avg_time_on_page_s < THRESHOLDS.lowDwellS &&
      snap.clarity !== undefined &&
      snap.clarity.scroll_depth_avg < THRESHOLDS.lowScrollDepth
    ) {
      reasons.push("high_bounce_low_scroll");
      evidence["bounce_rate"] = round(visits.bounce_rate, 3);
      evidence["scroll_depth_avg"] = round(snap.clarity.scroll_depth_avg, 3);
      evidence["avg_time_on_page_s"] = round(visits.avg_time_on_page_s, 1);
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

  if (snap.cannibalization && snap.cannibalization.length > 0) {
    reasons.push("duplicate_or_cannibalizing");
    evidence["competing_queries"] = snap.cannibalization.length;
    const first = snap.cannibalization[0];
    if (first.competing_urls.length > 0) {
      evidence["competing_url_example"] = first.competing_urls[0];
    }
  }

  const verdict = mapReasonsToVerdict(reasons);
  const confidence = confidenceFor(reasons, snap, decay);
  return {
    url: meta.url,
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
  if (set.has("high_bounce_low_scroll")) return "expand";
  return "hold";
}

function confidenceFor(reasons: ReasonCode[], snap: Snapshot, decay: DecayCurve): number {
  const sampleSize = snap.gsc.impressions + (snap.matomo?.visits ?? snap.ga4?.visits ?? 0);
  const sampleWeight = Math.min(1, sampleSize / 500);
  const windowWeight = Math.min(1, decay.buckets.length / 8);

  const sourcesWithData = [
    snap.gsc.impressions > 0,
    (snap.matomo?.visits ?? snap.ga4?.visits ?? 0) > 0,
    snap.clarity !== undefined,
    snap.citations !== undefined,
  ].filter(Boolean).length;
  const breadthWeight = sourcesWithData / 4;

  const agreementWeight = reasonAgreement(reasons);

  return round(
    0.35 * sampleWeight + 0.25 * windowWeight + 0.2 * breadthWeight + 0.2 * agreementWeight,
    2,
  );
}

function reasonAgreement(reasons: ReasonCode[]): number {
  const verdicts = new Set<VerdictKind>();
  for (const r of reasons) {
    const v = verdictForReason(r);
    if (v !== null) verdicts.add(v);
  }
  if (verdicts.size <= 1) return 1;
  return 0.5;
}

function verdictForReason(r: ReasonCode): VerdictKind | null {
  switch (r) {
    case "rising_clicks_continue_investment":
    case "citation_growth":
      return "double_down";
    case "stagnant_no_clicks":
      return "kill";
    case "duplicate_or_cannibalizing":
      return "merge";
    case "decay_60d_over_50pct":
    case "decay_30d_over_30pct":
    case "citation_loss":
    case "ctr_below_position_expected":
    case "rising_impressions_low_ctr":
    case "position_drift":
      return "refresh";
    case "thin_content_low_dwell":
    case "high_bounce_low_scroll":
      return "expand";
    case "fresh_post_too_young":
      return null;
    default:
      return null;
  }
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
