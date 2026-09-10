import { invoke } from "@tauri-apps/api/core"
import type { UsageLimit, UsagePeriod } from "../../../../shared/types/usage"
import { normalizeLimit } from "../../../../shared/utils/usage"

export interface UsageWindowSnapshot {
  id: string
  label: string
  usedPercent: number
  resetsAtIso?: string | null
  resetsAtEpochSeconds?: number | null
  windowMinutes?: number | null
}

export interface ClaudeUsageSnapshot {
  source: string
  fetchedAtMs?: number | null
  plan?: string | null
  windows: UsageWindowSnapshot[]
}

export interface CodexUsageSnapshot {
  source: string
  observedAtIso?: string | null
  plan?: string | null
  creditBalance?: string | null
  hasCredits?: boolean | null
  windows: UsageWindowSnapshot[]
}

/**
 * Local usage files are only reachable through the Rust side, so a plain
 * `vite dev` browser tab has no source to read.
 */
export function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

function toIso(value: Date) {
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
}

export function windowResetAt(snapshot: UsageWindowSnapshot) {
  if (snapshot.resetsAtIso) return toIso(new Date(snapshot.resetsAtIso))
  if (typeof snapshot.resetsAtEpochSeconds === "number") {
    return toIso(new Date(snapshot.resetsAtEpochSeconds * 1000))
  }
  return undefined
}

const periods: Record<string, UsagePeriod> = {
  "five-hour": "session",
  "seven-day": "weekly",
  weekly: "weekly"
}

export function toUsageLimit(snapshot: UsageWindowSnapshot): UsageLimit {
  return normalizeLimit({
    id: snapshot.id,
    label: snapshot.label,
    period: periods[snapshot.id] ?? "custom",
    usedPercent: snapshot.usedPercent,
    resetAt: windowResetAt(snapshot),
    unit: "percent"
  })
}

/** True once the window this reading belongs to has already rolled over. */
export function hasRolledOver(snapshot: UsageWindowSnapshot, now = Date.now()) {
  const resetAt = windowResetAt(snapshot)
  return resetAt !== undefined && new Date(resetAt).getTime() <= now
}

export function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.length > 0) return error
  if (error instanceof Error && error.message.length > 0) return error.message
  return fallback
}

export function readClaudeUsage() {
  return invoke<ClaudeUsageSnapshot>("read_claude_usage")
}

export function readCodexUsage() {
  return invoke<CodexUsageSnapshot>("read_codex_usage")
}
