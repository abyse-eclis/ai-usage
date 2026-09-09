# Providers

Provider integrations return a common `ProviderUsage` shape. A provider can fail independently without clearing cached data from other providers.

## Status

| Provider | MVP status | Notes |
| --- | --- | --- |
| Claude | Demo stable, real source disabled | Real usage source must be verified before enabling. Browser extraction would be experimental. |
| Codex | Demo stable, source abstraction added | `CodexUsageSource` supports CLI and browser sources. No stable CLI usage output is assumed. |
| ChatGPT | Demo stable, real source disabled | ChatGPT subscription usage is separate from Codex. If no verified source exposes usage, the UI shows unavailable. |

## Rules

- Do not invent public APIs or hardcode unverified endpoints.
- Preserve raw semantics when normalizing `% used` and `% remaining`.
- Keep unofficial extraction isolated, marked experimental, and failure-safe.
- Do not ask users to type provider passwords directly into the widget.
- Store any future session material only in OS secure storage or an encrypted local store.
- Redact `Authorization`, `Cookie`, session, and refresh token values from logs.

## Future Sources

- Official supported provider APIs if they become available.
- Stable local CLI usage output when providers expose it.
- User-authenticated browser sessions with local profile storage.
- Experimental browser extraction as a last resort.
