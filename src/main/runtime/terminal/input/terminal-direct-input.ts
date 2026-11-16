import type { RuntimeTerminalSend } from '../../../../shared/runtime-types'
import type { RuntimeTerminalWriteOptions } from './runtime-terminal-writer'
import type { RuntimeAgentPromptWriteOptions } from './agent-prompt-write-options'
import { OrcaRuntimeWithControllerKnowsPtyIsLive } from './terminal-input-dispatch'

/**
 * Ash terminals do not run general application-plugin input rewriters.
 * Dispatch the original input through the retained PTY, permission,
 * generation and agent prompt submission checks.
 */
export abstract class OrcaRuntimeWithDirectTerminalInput extends OrcaRuntimeWithControllerKnowsPtyIsLive {
  sendTerminal(
    handle: string,
    action: { text?: string; enter?: boolean; interrupt?: boolean },
    options: RuntimeTerminalWriteOptions
  ): Promise<RuntimeTerminalSend> {
    return this.deliverTerminalSend(handle, action, options)
  }

  sendTerminalAgentPrompt(
    handle: string,
    prompt: string,
    options: RuntimeAgentPromptWriteOptions
  ): Promise<RuntimeTerminalSend> {
    return this.deliverTerminalAgentPrompt(handle, prompt, options)
  }
}
