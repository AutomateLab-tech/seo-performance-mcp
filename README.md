# seo-performance-mcp

**Know which blog posts to refresh, expand, merge, or kill - without guessing.**

A Model Context Protocol (MCP) server that turns your scattered SEO and analytics data into one clear verdict per URL. Plug it into Claude, Cursor, or any MCP-aware client and ask: "Which three posts should I update this week?" - and get an answer backed by hard numbers.

## What it does

`seo-performance-mcp` unifies post-publish signals from every channel you already pay for:

- **Google Search Console** - clicks, impressions, CTR, position, top queries
- **Matomo** or **GA4** - visits, dwell time, bounce rate
- **Microsoft Clarity** - scroll depth, rage clicks, dead clicks
- **AI citation tracking** - which LLMs cite your URL today vs. last month
- **Sitemap / CMS** - publish dates, tags, word counts (any platform via XML sitemap; optional Ghost integration for richer metadata)

It then runs a deterministic rule engine over those signals and emits a verdict per URL:

> `refresh` / `expand` / `merge` / `kill` / `double_down` / `hold`

with reason codes, evidence, and a 0-1 confidence score. Reporting only - the server never mutates your posts.

## Why it matters

Most content teams have analytics in five tabs and a gut feeling. That's how good posts rot quietly, mediocre posts get over-promoted, and the obvious "rewrite this one" is invisible until traffic has already cratered.

This MCP closes the loop:

- One question, one URL in, one verdict out.
- Same logic across the whole cohort, so the ranking is comparable.
- All decisions traceable to numeric thresholds you can pin in `src/verdict/rules.ts`.
- AI clients (Claude, Cursor, MCP hosts) can drive the entire content audit in plain English.

## Who it's for

- **Content marketers** running a blog of 50+ posts and tired of guessing what to refresh.
- **SEO consultants** doing audits who want a portable, deterministic scoring layer instead of bespoke spreadsheets.
- **AI-first content teams** wiring up rewrite agents - this MCP is the upstream signal layer.
- **Indie publishers** on Ghost, WordPress, Hugo, Astro, Next, Webflow, or any CMS that exposes a sitemap.

## What you get

After one cohort run you have:

- A ranked table of every post with a verdict and confidence score.
- A markdown brief per "refresh" URL: numbers + top queries + suggested actions an editor (or a writing agent) can act on immediately.
- A list of "quick wins": queries sitting at positions 5-15 with below-expected CTR - the fastest title-rewrite wins on the property.
- A historical AI-citation diff: which LLMs cited you and stopped.

## Install

```bash
npx -y @automatelab/seo-performance-mcp
```

In a Claude, Claude Code, or Cursor MCP config:

```json
{
  "mcpServers": {
    "seo-performance": {
      "command": "npx",
      "args": ["-y", "@automatelab/seo-performance-mcp"],
      "env": {
        "POSTS_SITEMAP_URL": "https://example.com/sitemap.xml",
        "GSC_SERVICE_ACCOUNT_JSON": "<base64-encoded service-account JSON>",
        "GSC_SITE_URL": "sc-domain:example.com",
        "MATOMO_URL": "https://example.com/analytics",
        "MATOMO_TOKEN": "...",
        "MATOMO_SITE_ID": "1",
        "GA4_PROPERTY_ID": "123456789",
        "GA4_SERVICE_ACCOUNT_JSON": "<base64-encoded service-account JSON>",
        "CLARITY_PROJECT_ID": "...",
        "CLARITY_API_TOKEN": "...",
        "CITATION_INTELLIGENCE_URL": "https://citation.example.com"
      }
    }
  }
}
```

Every env var is optional. Adapters that lack their env config skip their slice of the snapshot; the server still boots. The verdict engine works on whatever slices are present.

## Platform integration

Point it at any site, no CMS plugin required. The post-discovery layer resolves in priority order:

1. **`POSTS_LIST`** - JSON array of `{url, title?, published_at?, tags?, word_count?}`. Use this when you already have a content index and want exact control.
2. **Ghost Admin API** - if both `GHOST_ADMIN_API_URL` and `GHOST_ADMIN_API_KEY` are set, Ghost is used as a richer metadata source. Optional.
3. **HTML extraction** - per-URL `og:title`, `article:published_time`, and JSON-LD `datePublished` are read live from the URL.
4. **XML sitemap** - set `POSTS_SITEMAP_URL` to your sitemap (or sitemap index) and the server enumerates posts from `<loc>` + `<lastmod>`.

Most users only need `POSTS_SITEMAP_URL`. WordPress, Hugo, Astro, Next.js, Webflow, Framer, Wix, Squarespace, Notion-as-a-site, Substack-mirror sites all expose a sitemap by default.

To add a brand-new platform: nothing to build - just point `POSTS_SITEMAP_URL` at it.

## Tools exposed

| Tool | What it returns |
|---|---|
| `posts.list` | Posts with `{url, title, age_days, tags}` from sitemap, Ghost, or your `POSTS_LIST`. |
| `posts.snapshot` | Per-URL unified rollup for a 30/60/90-day window: GSC + Matomo + GA4 + Clarity + citations + meta. |
| `posts.decay_curve` | Weekly GSC clicks/impressions/position buckets + a `decay/plateau/growth` trend label. |
| `posts.verdict` | Verdict (`refresh/expand/merge/kill/double_down/hold`) + reason codes + 0-1 confidence. |
| `posts.refresh_brief` | Markdown brief for a human or downstream LLM editor: numbers, top queries, suggested actions. |
| `cohort.report` | Cohort verdict table sorted by priority + confidence. "Which three posts should I refresh this week?" |
| `posts.cite_loss` | LLM citations that dropped off for a given URL. Needs `CITATION_INTELLIGENCE_URL`. |
| `gsc.quick_wins` | `(page, query)` pairs at positions 5-15 with low CTR - fastest title-rewrite wins. |

## Use as a GitHub Action

Run any of the tools on a cron from CI and post the output to a GitHub Issue, Discussion, or PR. The action is published on the GitHub Marketplace.

```yaml
- uses: AutomateLab-tech/seo-performance-mcp@v1
  with:
    tool: cohort.report
    format: markdown
    input: '{"window": 90, "min_age_days": 90, "limit": 20}'
    gsc-service-account-json: ${{ secrets.GSC_SERVICE_ACCOUNT_JSON }}
    gsc-site-url: ${{ secrets.GSC_SITE_URL }}
    posts-sitemap-url: ${{ secrets.POSTS_SITEMAP_URL }}
```

Outputs:

| Output | Description |
|---|---|
| `result` | Tool output as a multi-line string (markdown or JSON, per `format`). |
| `result-file` | Path of the file the tool output was written to. Hand to `peter-evans/create-issue-from-file` etc. |
| `rows` | For `cohort.report` with `format: json` only: number of rows returned. |

A complete weekly-audit workflow that opens a GitHub Issue with the cohort report is in [examples/weekly-cohort-report.yml](./examples/weekly-cohort-report.yml).

## Use as a one-shot CLI

The package also ships a `seo-perf-cli` bin so you can run a single tool without an MCP client:

```bash
npx -p @automatelab/seo-performance-mcp seo-perf-cli cohort.report \
  --input '{"window": 90, "limit": 20}' \
  --format markdown
```

Same env vars as the MCP server. `--format markdown` is supported for `cohort.report` and `posts.refresh_brief`; other tools fall back to fenced JSON.

## Companion skills + Cursor rule

Three thin routing files ship in the repo so the LLM in your client knows *when* to reach for these tools:

- `skills/seo-performance/SKILL.md` - tool-routing skill. Drop into `~/.claude/skills/seo-performance/` (or `.claude/skills/` per project) to auto-load in Claude Code. Routes a single question to the right tool.
- `skills/weekly-audit/SKILL.md` - one-shot weekly audit playbook. Composes `gsc.quick_wins` + `cohort.report` + `posts.cite_loss` into a deduped, cross-signal ranked digest with proposed edits per URL. Drop in alongside the routing skill.
- `cursor/rules/seo-performance.mdc` - copy to `.cursor/rules/seo-performance.mdc` in any Cursor workspace.

All optional. The MCP server works without them; they just shorten the "which tool do I call" round-trip.

## MCP prompts

The server exposes three prompts that bundle the playbook. Any MCP client (Claude Desktop, Claude Code, Cursor, Continue) can list and invoke them:

| Prompt | What it runs |
|---|---|
| `audit_cohort` | `cohort.report` on posts >=90d, then `posts.refresh_brief` per refresh/expand/merge row. The weekly audit. |
| `find_quick_wins` | `gsc.quick_wins` (positions 5-15) + per-URL `posts.snapshot`, then proposes verbatim-query meta_title rewrites. |
| `citation_loss_sweep` | `posts.cite_loss` per URL, refresh_brief for any with losses, targeted H1/lead phrasing recommendations. |

## Verdict engine

Deterministic, rule-based, traceable. Reason codes:

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

The mapping (reasons → verdict) and every threshold lives in `src/verdict/rules.ts`. Edit it, pin it in tests, ship your own rule book.

## Development

```bash
npm install
npm run dev        # tsx src/index.ts
npm run build      # tsc
npm test           # vitest
```

## License

MIT
