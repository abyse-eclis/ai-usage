# Architecture

AI Usage Monitor is a local-first Tauri 2 desktop widget. The frontend owns presentation, provider orchestration, demo mode, cache state, reset countdowns, and settings. The Tauri shell owns native window behavior, tray integration, notifications, startup integration, and future secure credential storage.

## Feature Layout

- `src/app`: app entry, providers, and routing stubs.
- `src/features/widget`: widget UI, responsive size behavior, and usage cache store.
- `src/features/providers`: provider-specific adapters grouped by provider.
- `src/features/settings`: persisted settings and settings panel.
- `src/features/notifications`: threshold notification rules and spam prevention.
- `src/features/window-manager`: frontend wrapper over Tauri window commands.
- `src/shared`: common usage types, time helpers, normalization, and thresholds.
- `src-tauri`: Rust shell, commands, tray, and native plugins.

## Size Behavior

Presets are shortcuts, not layout assumptions:

- Small: 320 x 240
- Medium: 420 x 560
- Large: 640 x 760
- Custom: user-resized

The UI uses `ResizeObserver` and available container size to switch between compact, medium, and detailed layouts.

## Local-First Rule

The app does not send usage, sessions, tokens, or credentials to any external service. Demo mode is on by default so the UI can be developed without provider login.
