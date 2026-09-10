/**
 * Traces the companion/popup hover flow. Every step of "pointer enter ->
 * request show -> native window shown" logs, so a broken hover can be located
 * without guesswork. Never log provider payloads, tokens, or cookies here.
 */
const enabled = import.meta.env.DEV

export function companionLog(message: string, detail?: unknown) {
  if (!enabled) return
  if (detail === undefined) console.log(message)
  else console.log(message, detail)
}
