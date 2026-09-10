# Providers

Provider integrations return a common `ProviderUsage` shape. A provider can fail independently without clearing cached data from other providers.

## Status

| Provider | Status | Notes |
| --- | --- | --- |
| Claude | Live from a local file | Reads the utilization cache Claude Code writes to `~/.claude.json`. |
| Codex | Live from a local file | Reads the rate limits the Codex CLI records in its newest session rollout. |
| ChatGPT | Unavailable | The ChatGPT conversation quota is separate from Codex and no local file records it. |

## Verified Local Sources

Both readers run in Rust and return only the fields listed below, so no
credential or transcript content ever reaches the webview.

### Claude — `~/.claude.json`

Claude Code caches the account utilization it receives from Anthropic under
`cachedUsageUtilization`. The reader takes `five_hour` and `seven_day` (plus the
model specific windows when present) along with `fetchedAtMs` and the plan tier
from `oauthAccount.organizationRateLimitTier`. Windows carrying an internal
codename are ignored rather than shown under an invented label.

The cache only moves while Claude Code runs. When the cached `five_hour` window
has already reset, the provider keeps showing the reading and marks it stale.

### Codex — `~/.codex/sessions/**/*.jsonl`

Every `token_count` event carries a `rate_limits` block with `primary` (a
300 minute window), `secondary` (10080 minutes), `plan_type`, and `credits`.
The reader scans the newest rollout backwards for the last such event, falling
through to the next most recent rollouts when a session reported none.

Rollouts reach tens of megabytes, so the scan walks the file backwards in
256 KB chunks and stops after 8 MB instead of loading the file.

## Rules

- Do not invent public APIs or hardcode unverified endpoints.
- Preserve raw semantics when normalizing `% used` and `% remaining`.
- Keep unofficial extraction isolated, marked experimental, and failure-safe.
- Do not ask users to type provider passwords directly into the widget.
- Store any future session material only in OS secure storage or an encrypted local store.
- Redact `Authorization`, `Cookie`, session, and refresh token values from logs.

## Future Sources

- Official supported provider APIs if they become available.
- A local source for the ChatGPT conversation quota, if one ever appears.
- User-authenticated browser sessions with local profile storage.
- Experimental browser extraction as a last resort.
