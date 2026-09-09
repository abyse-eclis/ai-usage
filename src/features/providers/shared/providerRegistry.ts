import type { UsageProvider } from "../../../shared/types/usage"
import { claudeProvider } from "../claude/services/claudeProvider"
import { codexProvider } from "../codex/services/codexProvider"
import { chatGptProvider } from "../chatgpt/services/chatGptProvider"
import { demoProviders } from "./services/demoProvider"

export function getUsageProviders(demoMode: boolean): UsageProvider[] {
  if (demoMode) return demoProviders
  return [claudeProvider, codexProvider, chatGptProvider]
}
