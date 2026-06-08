---
name: seo-performance
description: When the user wants to audit blog SEO performance, decide which posts to refresh / expand / merge / kill / double-down on, find SERP quick wins (positions 5-15 with low CTR), inspect post-publish signals (GSC, Matomo, GA4, Clarity), detect AI-citation losses, or run a cohort report across many URLs. Also triggers on "what should I refresh this week", "which posts are dying", "rewrite my underperforming titles", "AI citation drop", "GSC quick wins", "post audit".
---

# seo-performance

Companion skill for the `@automatelab/seo-performance-mcp` server. It tells the model which MCP tool to call for which content-ops question.

## When to use

Fire this skill whenever the user is making an editorial decision about an *existing* URL. Not for new-post writing - that's a different skill.

## The mental model

Every URL on a content site is in one of six states:

| Verdict | Trigger |
|---|---|
| `refresh` | Decay > 30%/30d OR CTR << position-expected OR AI citations dropped |
| `expand` | Thin content + low dwell |
| `merge` | Cannibalisation with a sibling URL |
| `kill` | Stagnant, no clicks despite impressions |
| `double_down` | Rising clicks OR active AI citations |
| `hold` | Too young (<90d) OR healthy plateau |

The MCP server returns one of those verdicts deterministically. Your job in this skill is to route the question to the right tool.

## Tool routing

| User asks | Call |
|---|---|
| "audit my blog" / "what should I refresh this week" | `cohort_report` with `min_age_days=90`, then `posts_refresh_brief` on every refresh/expand/merge row |
| "any quick title rewrites" / "low CTR pages" | `gsc_quick_wins` (window=90, positions 5-15) |
| "is this post dying" / "show me the data for X" | `posts_snapshot` + `posts_decay_curve` + `posts_verdict` on the URL |
| "give me a refresh brief for X" | `posts_refresh_brief` |
| "did we lose any AI citations" | `posts_cite_loss` per URL, or use the `citation_loss_sweep` prompt |
| "list my posts" | `posts_list` (sitemap-driven; no CMS plugin needed) |

## Prompts available from the MCP server

These ship with the server and any MCP client can list them:

- `audit_cohort` - the full weekly audit playbook
- `find_quick_wins` - SERP quick-win sweep with rewrite suggestions
- `citation_loss_sweep` - AI-citation recovery loop

Prefer invoking a prompt over re-deriving the workflow.

## Output discipline

- When showing verdict output, always lead with the URL and verdict label, then reasons, then numbers. Reasons explain the verdict; numbers prove it.
- For refresh briefs, hand the markdown to the user verbatim - don't paraphrase.
- Never recommend an edit that wasn't grounded in a tool call this turn.

## Install the MCP

In your MCP client config (Claude Desktop, Claude Code, Cursor, Continue):

```json
{
  "mcpServers": {
    "seo-performance": {
      "command": "npx",
      "args": ["-y", "@automatelab/seo-performance-mcp"],
      "env": {
        "POSTS_SITEMAP_URL": "https://yoursite.com/sitemap.xml",
        "GSC_SITE_URL": "sc-domain:yoursite.com",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/google-creds.json"
      }
    }
  }
}
```

Every env var is optional - adapters that lack their config get skipped silently.
