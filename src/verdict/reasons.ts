// Human-readable strings for ReasonCode values. These appear in refresh briefs and tool output.

import type { ReasonCode } from "../types.js";

export const REASON_STRINGS: Record<ReasonCode, string> = {
  ctr_below_position_expected:
    "CTR is materially below the expected curve for this position. Likely a weak title / meta description.",
  position_drift:
    "Average position has drifted >3 places vs the baseline window. Algorithmic or competitor pressure.",
  decay_30d_over_30pct:
    "Clicks fell by more than 30% in the last 30 days. Refresh window is open.",
  decay_60d_over_50pct:
    "Clicks fell by more than 50% over 60 days. Refresh is now overdue.",
  stagnant_no_clicks:
    "Zero clicks for the full window despite impressions. Either re-target the post or kill it.",
  thin_content_low_dwell:
    "Time on page is below 30 seconds and word count is under 500. Page reads as thin.",
  rising_impressions_low_ctr:
    "Impressions are growing but CTR remains <1%. Improve the title and meta description to capitalise.",
  rising_clicks_continue_investment:
    "Clicks are growing month over month. Double down: build supporting cluster posts.",
  citation_loss:
    "Page was previously cited by at least one LLM and the citation has dropped off. Refresh to win it back.",
  citation_growth:
    "AI citations are appearing for this URL. Expand the section that is being quoted.",
  duplicate_or_cannibalizing:
    "Top queries on this page overlap heavily with another published URL. Consider merging.",
  high_bounce_low_scroll:
    "Bounce rate >75% and median scroll depth <30%. The page is failing the click intent.",
  fresh_post_too_young:
    "Post is younger than 90 days. Hold for one more measurement window before verdicting.",
};
