# AI Usage Monitor

Local-first Windows desktop widget for tracking AI usage limits, quota state, and reset timers across Claude, Codex, ChatGPT, and future providers.

Screenshot placeholder: add a captured widget image after the native shell can be run.

## Features

- Tauri 2, React, TypeScript, Tailwind CSS, Vite, Zustand, and Lucide Icons.
- Frameless transparent widget with dark glass styling.
- Small, Medium, Large, and Custom responsive widget layouts.
- Live Claude and Codex usage read from local CLI state files.
- Demo mode with Claude, Codex, and ChatGPT mock data, off by default.
- Shared provider interface and usage normalization.
- Local cache for last successful provider usage.
- Auto refresh, manual refresh, reset countdowns, and threshold notifications.
- Settings for refresh interval, widget behavior, appearance, notifications, demo mode, and experimental provider flags.
- System tray shell with show, refresh, size, settings, and quit actions.

## Supported Providers

| Provider | Status | Implementation |
| --- | --- | --- |
| Claude | Live | Reads the utilization cache Claude Code writes to `~/.claude.json`. Requires Claude Code installed and signed in. |
| Codex | Live | Reads the rate limits the Codex CLI records in its newest session rollout under `~/.codex/sessions`. Requires the Codex CLI installed and used at least once. |
| ChatGPT | Unavailable | The ChatGPT conversation quota is separate from Codex and no local file records it. |

Both readers are local file reads. Neither contacts a provider API, and neither
needs a key. Numbers refresh when the matching CLI next runs, so a provider you
have not used for a while keeps showing its last reading. See
[docs/providers.md](docs/providers.md) for the exact fields consumed.

## Installation

Install Node.js, pnpm, and the Rust toolchain required by Tauri 2.

```powershell
pnpm.cmd install
```

PowerShell script execution may block `pnpm`; use `pnpm.cmd` on Windows if that happens.

## Development

```powershell
pnpm.cmd dev
pnpm.cmd tauri:dev
pnpm.cmd test
pnpm.cmd build
pnpm.cmd tauri:build
```

Demo mode is off by default so the widget shows real readings. Set
`VITE_DEMO_MODE=true` to build with the mock provider data instead, or toggle
demo mode in Settings.

## Security

AI Usage Monitor is local-first:

- No hosted backend.
- No telemetry by default.
- No password storage.
- No usage/session uploads.
- Future session cookies or tokens must use OS secure storage or encrypted local storage.
- Logs must redact authorization headers, cookies, session tokens, and refresh tokens.

## Authentication

The MVP does not ask for Claude, OpenAI, or ChatGPT passwords. Future provider connection flows should open a browser login/session and store only required local session material securely.

## Widget Sizes

- Small: compact glance view around 320 x 240.
- Medium: default detailed widget around 420 x 560.
- Large: full detail view around 640 x 760.
- Custom: free resize with container-based responsive layout.

## Limitations

- ChatGPT conversation usage stays unavailable because no local source records it.
- Claude and Codex readings come from local CLI caches, so they only advance when those CLIs run.
- Tauri native builds require Rust/Cargo and Windows WebView2 tooling.
- Tray tooltip usage summaries are planned after native event wiring is expanded.

## Roadmap

- Phase 2: Gemini, Cursor, GitHub Copilot, OpenRouter, OpenAI API, Anthropic API.
- Phase 3: usage history, graphs, daily/weekly analytics, cost tracking, monthly spend.
- Phase 4: macOS and Linux support.
