import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeWithDirectTerminalInput } from './terminal-direct-input'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), 'src/main/runtime/terminal/input', path), 'utf8')
}

describe('Ash terminal input without general application-plugin interception', () => {
  it('directly delegates programmatic terminal sends with unchanged action and write options', async () => {
    const runtime = Object.create(
      OrcaRuntimeWithDirectTerminalInput.prototype
    ) as OrcaRuntimeWithDirectTerminalInput
    const result = { handle: 'term-1', accepted: true, bytesWritten: 5 }
    const deliver = vi.fn(async () => result)
    Reflect.set(runtime, 'deliverTerminalSend', deliver)
    const action = { text: 'hello', enter: true }
    const options = { inputKind: 'programmatic' } as never
    await expect(runtime.sendTerminal('term-1', action, options)).resolves.toEqual(result)
    expect(deliver).toHaveBeenCalledExactlyOnceWith('term-1', action, options)
  })

  it('directly delegates agent prompts while the downstream PTY generation guard remains intact', async () => {
    const runtime = Object.create(
      OrcaRuntimeWithDirectTerminalInput.prototype
    ) as OrcaRuntimeWithDirectTerminalInput
    const result = { handle: 'term-2', accepted: true, bytesWritten: 6 }
    const deliver = vi.fn(async () => result)
    Reflect.set(runtime, 'deliverTerminalAgentPrompt', deliver)
    const options = { inputKind: 'driving', requestId: 'req-1' } as never
    await expect(runtime.sendTerminalAgentPrompt('term-2', 'review', options)).resolves.toEqual(
      result
    )
    expect(deliver).toHaveBeenCalledExactlyOnceWith('term-2', 'review', options)
    expect(source('terminal-input-dispatch.ts')).toContain('serializeAgentPromptSubmission')
    expect(source('terminal-input-dispatch.ts')).toContain('assertAgentPromptGeneration')
  })

  it('removes plugin-writer and ordering sources, retaining the runtime terminal chain', () => {
    for (const path of [
      'terminal-send-plugin-hook.ts',
      'terminal-plugin-hooked-input.ts',
      'terminal-send-plugin-hook.test.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), 'src/main/runtime/terminal/input', path))).toBe(
        false
      )
    }
    const entry = source('terminal-agent-status-and-submission.ts')
    expect(entry).toContain('OrcaRuntimeWithDirectTerminalInput')
    expect(entry).not.toMatch(/PluginHooked|terminal-plugin-hooked-input/)
    const direct = source('terminal-direct-input.ts')
    expect(direct).toContain('deliverTerminalSend(handle, action, options)')
    expect(direct).toContain('deliverTerminalAgentPrompt(handle, prompt, options)')
    expect(direct).not.toMatch(/runPluginHook|pluginHookWanted|TerminalPluginHookOrder/)
  })
})
