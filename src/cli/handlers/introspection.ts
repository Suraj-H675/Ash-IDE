import type { CommandHandler } from '../dispatch'
import { ASH_COMMAND_SPECS } from '../specs'
import { buildAgentContext, formatAgentContextSummary } from '../agent-context'

export const INTROSPECTION_HANDLERS: Record<string, CommandHandler> = {
  // Keep schema output runtime-free so it works offline and over SSH.
  'agent-context': async ({ json }) => {
    const schema = buildAgentContext(ASH_COMMAND_SPECS)
    if (json) {
      console.log(JSON.stringify(schema, null, 2))
      return
    }
    console.log(formatAgentContextSummary(schema))
  }
}
