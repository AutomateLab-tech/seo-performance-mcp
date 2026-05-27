// Shared types for seo-performance-mcp.
// Per-URL unified snapshot, decay curve, verdict shape, and reason codes.

export interface PostMeta {
  slug: string;
  url: string;
  title: string;
  published_at: string;
  updated_at?: string;
  age_days: number;
  status: string;
  tags: string[];
  word_count?: number;
  headings?: string[];
  excerpt?: string;
}

export interface GscMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  top_queries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
}

export interface VisitMetrics {
  visits: number;
  unique_visitors: number;
  avg_time_on_page_s: number;
  bounce_rate: number;
  goal_conversions?: number;
}

export interface BehaviorMetrics {
  scroll_depth_avg: number;
  rage_clicks: number;
  dead_clicks: number;
  excessive_scroll: number;
  session_recordings_url?: string;
}

export interface CitationMetrics {
  active_citations: number;
  last_seen_at?: string;
  llms: Array<{ llm: string; query: string; last_seen: string; replaced_by_url?: string }>;
}

export interface CannibalizationHit {
  query: string;
  competing_urls: string[];
}

export interface Snapshot {
  meta: PostMeta;
  window_days: 30 | 60 | 90;
  gsc: GscMetrics;
  matomo?: VisitMetrics;
  ga4?: VisitMetrics;
  clarity?: BehaviorMetrics;
  citations?: CitationMetrics;
  cannibalization?: CannibalizationHit[];
  baseline?: {
    clicks: number;
    impressions: number;
    position: number;
  };
}

export interface DecayBucket {
  week_start: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface DecayCurve {
  url: string;
  buckets: DecayBucket[];
  trend: "decay" | "plateau" | "growth";
  decay_pct: number;
}

export type VerdictKind =
  | "refresh"
  | "expand"
  | "merge"
  | "kill"
  | "double_down"
  | "hold";

export type ReasonCode =
  | "ctr_below_position_expected"
  | "position_drift"
  | "decay_30d_over_30pct"
  | "decay_60d_over_50pct"
  | "stagnant_no_clicks"
  | "thin_content_low_dwell"
  | "rising_impressions_low_ctr"
  | "rising_clicks_continue_investment"
  | "citation_loss"
  | "citation_growth"
  | "duplicate_or_cannibalizing"
  | "high_bounce_low_scroll"
  | "fresh_post_too_young";

export interface Verdict {
  url: string;
  verdict: VerdictKind;
  reasons: ReasonCode[];
  confidence: number;
  evidence: Record<string, number | string | undefined>;
}

export interface ToolError {
  type: "config_missing" | "fetch_error" | "not_found" | "rate_limited" | "internal";
  message: string;
  detail?: Record<string, unknown>;
}

export class ConfigMissingError extends Error {
  constructor(public readonly env: string) {
    super(`Missing required env: ${env}`);
    this.name = "ConfigMissingError";
  }
}
