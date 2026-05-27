# @automatelab/seo-performance-mcp

Post-publish SEO performance MCP. Unifies Google Search Console, Matomo, GA4, Microsoft Clarity, AI-citation, and Ghost signals per URL and emits a verdict per post: **refresh / expand / merge / kill / double_down / hold** - with reason codes.

Reporting only. The MCP never mutates posts.

## Install

```bash
npx -y @automatelab/seo-performance-mcp
```

Or in a Claude / Claude Code / Cursor MCP config:

```json
{
  "mcpServers": {
    "seo-performance": {
      "command": "npx",
      "args": ["-y", "@automatelab/seo-performance-mcp"],
      "env": {
        "GSC_SERVICE_ACCOUNT_JSON": "<base64-encoded service-account JSON>",
        "GSC_SITE_URL": "sc-domain:example.com",
        "MATOMO_URL": "https://example.com/analytics",
        "MATOMO_TOKEN": "...",
        "MATOMO_SITE_ID": "1",
        "GA4_PROPERTY_ID": "123456789",
        "GA4_SERVICE_ACCOUNT_JSON": "<base64-encoded service-account JSON>",
        "CLARITY_PROJECT_ID": "...",
        "CLARITY_API_TOKEN": "...",
        "GHOST_ADMIN_API_URL": "https://example.com",
        "GHOST_ADMIN_API_KEY": "id:secret",
        "CITATION_INTELLIGENCE_URL": "https://citation.example.com"
      }
    }
  }
}
```

Every env var is optional. Adapters that lack their env config skip their slice of the snapshot; the MCP server still boots. The verdict engine works on whatever slices are present.

## Tools

| Tool | What it returns |
|---|---|
| `posts.list` | Published Ghost posts with `{slug, url, title, age_days, tags}`. |
| `posts.snapshot` | Per-URL unified rollup for a 30/60/90-day window: GSC + Matomo + GA4 + Clarity + citations + Ghost meta. |
| `posts.decay_curve` | Weekly GSC clicks/impressions/position buckets + a `decay/plateau/growth` trend label. |
| `posts.verdict` | Verdict (`refresh/expand/merge/kill/double_down/hold`) + reason codes + 0-1 confidence. |
| `posts.refresh_brief` | Markdown brief for a human or downstream LLM editor: numbers, top queries, suggested actions. |
| `cohort.report` | Cohort verdict table sorted by priority + confidence ("which three posts should I refresh this week?"). |
| `posts.cite_loss` | LLM citations that dropped off for a given URL. Needs `CITATION_INTELLIGENCE_URL`. |
| `gsc.quick_wins` | (page, query) pairs at positions 5-15 with low CTR - fastest title-rewrite wins. |

## Verdict engine

The decision is rule-based and deterministic. Reason codes:

- `ctr_below_position_expected`
- `position_drift`
- `decay_30d_over_30pct` / `decay_60d_over_50pct`
- `stagnant_no_clicks`
- `thin_content_low_dwell`
- `rising_impressions_low_ctr` / `rising_clicks_continue_investment`
- `citation_loss` / `citation_growth`
- `duplicate_or_cannibalizing`
- `high_bounce_low_scroll`
- `fresh_post_too_young`

Mapping lives in `src/verdict/rules.ts`. Pin thresholds there.

## Development

```bash
npm install
npm run dev        # tsx src/index.ts
npm run build      # tsc
npm test           # vitest
```

## License

MIT
