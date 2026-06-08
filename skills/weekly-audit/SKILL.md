---
name: weekly-audit
description: "One-shot weekly SEO audit that composes the seo-performance MCP tools into a single prioritized digest with proposed edits per URL. Triggers: 'weekly audit', 'what should I refresh this week', 'top 5 SEO actions', 'cross-signal audit', 'find my highest-leverage edits'."
---

# weekly-audit

Companion skill for `@automatelab/seo-performance-mcp`. Where the base `seo-performance` skill routes a single question to the right tool, **this skill runs the full weekly playbook end-to-end** and returns one ranked action list.

The MCP server already exposes an `audit_cohort` prompt that runs a cohort report and emits briefs. This skill is one layer higher: it **cross-references three independent signals** (quick wins, cohort verdicts, citation losses), dedupes by URL, and ranks by how many signals agree.

## When to use

The user wants the answer to "what should I edit this week" in one go - not a chat-driven exploration. For single-URL questions, defer to the base `seo-performance` skill.

## What it does

Read-only. Proposes edits. Never applies them. Wiring the apply path is up to your CMS - keep audit and apply as separate skills.

## Steps

### 1. Pull three lists in parallel

Issue these in a single message:

- `gsc_quick_wins` with `window=90, min_position=5, max_position=15, min_impressions=50, limit=20`
- `cohort_report` with `min_age_days=90, window=30, limit=20`
- `posts_list` with `limit=50, min_age_days=30` (input for the citation sweep)

### 2. Citation-loss sweep

For the top 15 URLs from `posts_list` (oldest first), call `posts_cite_loss` per URL. Keep only URLs with `losses[].length > 0`. If `CITATION_INTELLIGENCE_URL` is unset, this step returns empty - skip it.

### 3. Dedupe and rank

Merge by URL. A URL appearing in multiple lists gets a priority boost:

| Signal | Weight |
|---|---|
| `cohort_report` verdict = `refresh` or `merge` | 3 |
| `gsc_quick_wins` has any query at 0% CTR | 2 |
| `posts_cite_loss` has losses | 2 |
| `cohort_report` verdict = `expand` or `double_down` | 1 |
| `gsc_quick_wins` low-CTR only | 1 |

Sort by total weight desc, then by `cohort_report` confidence desc. Take top 5.

### 4. Per top-5 URL, propose one concrete edit

Pick the single highest-lift edit for the dominant signal:

- **Quick-win URL with 0% CTR query at position 5-15** -> rewrite `meta_title` using the query verbatim, under 60 chars.
- **`refresh` verdict with `decay_30d_over_30pct`** -> propose a new H2 + intro paragraph targeting the top GSC query.
- **`merge` verdict** -> name the sibling URL and recommend a 301 target.
- **Citation loss** -> propose H1 + lead-paragraph phrasing that mirrors the lost query verbatim (LLMs cite phrases, not paraphrases).
- **`expand` verdict** -> name 3 FAQ questions to add (pull from `posts_snapshot` top queries).

### 5. Output format

Markdown digest. For each of the 5:

```
## <n>. <URL> -> <verdict label or "quick-win">

**Why:** <one-sentence plain-English reason>

**Numbers:** clicks <X>, impressions <Y>, avg pos <Z>, top query "<q>" (<CTR>% at pos <P>)

**Proposed edit:** <verbatim copy of the new meta_title / H1 / FAQ block>
```

End with a one-line summary: "Top 3 to ship this week: <url1>, <url2>, <url3>."

## House-style rules - fill in for your site

The MCP doesn't know your brand voice. Before proposing edits, the skill should enforce **your** rules. Drop a list here when adopting the skill, e.g.:

- Title case vs sentence case
- Em-dash policy (allowed / replace with hyphen / replace with comma)
- Emoji policy (allowed in titles / body only / banned)
- Canonical URL shape (e.g. `/blog/<slug>/` vs `/<slug>/`)
- Forbidden words or phrases
- Persona / voice notes (plain words, no jargon, etc.)

If a proposed edit violates a rule, rewrite it before showing.

## What this skill does NOT do

- It does not apply edits. No CMS writes. The output is a digest you paste into your CMS or hand to a future apply-skill.
- It does not duplicate the MCP. Tool contracts live in the MCP server.
- It does not auto-publish, auto-tag, or auto-redirect.

## Known limitations

- **Sitemap `<lastmod>` is unreliable** if a recent deploy reset all values. For accurate age filtering, configure Ghost (or `POSTS_LIST`) so per-URL `getPostMeta` has a real source.
- **Verdict engine needs >=90-day-old posts** to fire useful verdicts. New sites get mostly `hold/fresh_post_too_young`. Lean on `gsc_quick_wins` (no age filter) until the cohort matures.
- **Citation-loss step is a no-op without `CITATION_INTELLIGENCE_URL`.** Set it when ready; until then the sweep contributes nothing to ranking.
