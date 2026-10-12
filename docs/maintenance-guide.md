# SEO Performance MCP maintenance guide

Missing connector data is different from zero traffic. Inspect available sources and reason codes before acting on a verdict. Reports propose editorial work; they do not edit or delete pages.

## Installation and compatibility

Follow the repository README for the supported install method and runtime. Pin the version used in a reproducible example. Keep credentials in your client configuration, outside shared fixtures.

## Verified tool surface

The local compiled server returned these names through MCP `tools/list` on 12 October 2026. Recheck after upgrading.

- `posts_list`
- `posts_snapshot`
- `posts_decay_curve`
- `posts_verdict`
- `posts_refresh_brief`
- `cohort_report`
- `posts_cite_loss`
- `gsc_quick_wins`
- `bing_quick_wins`

## First call

Start with `posts_verdict`. Required fields: `url`. Read its input schema before passing a recorded fixture.

## Verify a change

Record the package or snapshot version, exact input, observation time and actual output. Check a materially different input and a valid neighboring case. Treat expected output as a fixture, not a live measurement.
