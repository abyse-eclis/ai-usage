import { invoke } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { companionLog } from "../utils/log"

/**
 * The fetch loop lives in the Main Widget window, which stays loaded even when
 * hidden, so the companion asks for a refresh instead of calling providers
 * itself. The fresh numbers come back to every window as a broadcast snapshot.
 *
 * Two kinds of refresh exist, and the difference matters:
 *
 * - `refreshRequestEvent` re-reads the files the CLIs have already written.
 *   Free, and what the tray item and the automatic interval use.
 * - `cliRefreshRequestEvent` first runs the user's configured CLI commands so
 *   those files are rewritten. That spends provider quota, so it is only ever
 *   sent from an explicit press of the reload button.
 */
export const refreshRequestEvent = "tray-refresh"
export const cliRefreshRequestEvent = "usage-refresh-with-cli"
/** Emitted by the widget once a refresh settles, so spinners can stop. */
export const refreshFinishedEvent = "usage-refresh-finished"

export interface CliRefreshResult {
  ok: boolean
  exitCode?: number
  output: string
}

export async function requestUsageRefresh() {
  companionLog("[Companion] asking the widget to refresh")
  await emit(cliRefreshRequestEvent).catch((error) => companionLog("[Companion] refresh failed", error))
}

/** Runs one configured command through the shell, as the user. */
export async function runCliRefresh(command: string) {
  return invoke<CliRefreshResult>("run_cli_refresh", { command })
}
