// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editorSaveTransform } from './editor-save-transform-pipeline'
import { editorFormatOnSave } from './editor-format-on-save'

vi.mock('./editor-format-on-save', () => ({
  editorFormatOnSave: vi.fn()
}))
const originalApi = Object.getOwnPropertyDescriptor(window, 'api')
const formatter = vi.mocked(editorFormatOnSave)

const store = {
  getState: () => ({
    settings: { editorFormatOnSave: false },
    openFiles: [],
    editorDrafts: {}
  })
} as never

const file = {
  id: 'source-editor',
  filePath: '/work/repo/source.ts',
  worktreeId: 'local-repo',
  relativePath: 'source.ts',
  language: 'typescript'
} as never

function request(trigger: 'user' | 'autosave' | 'restart' | 'overwrite' = 'user') {
  return {
    trigger,
    recordId: 'source-editor',
    discardEpoch: 0,
    invocation: {
      operation: {
        mutationContext: () => ({ worktreeId: 'local-repo' }),
        assertAuthorityCurrent: vi.fn()
      }
    }
  } as never
}

beforeEach(() => {
  formatter.mockReset()
  formatter.mockReturnValue(null)
})

afterEach(() => {
  if (originalApi) {
    Object.defineProperty(window, 'api', originalApi)
  } else {
    Reflect.deleteProperty(window, 'api')
  }
})

describe('Ash editor saves never delegate to general application-plugin hooks', () => {
  it.each(['user', 'autosave', 'restart', 'overwrite'] as const)(
    'keeps original %s save text even if an old plugin host is injected',
    (trigger) => {
      const call = vi.fn(async () => ({ kind: 'allow', text: 'PLUGIN-INJECTED' }))
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: { plugins: { editorSaveHook: call } }
      })
      expect(editorSaveTransform(store, file, request(trigger), 'original text')).toBeNull()
      expect(call).not.toHaveBeenCalled()
      expect(formatter).toHaveBeenCalledOnce()
    }
  )

  it('keeps the retained formatter result without applying a plugin rewrite or denial', async () => {
    const call = vi.fn(async () => ({
      kind: 'deny',
      pluginKey: 'untrusted/plugin',
      reason: 'block write'
    }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { plugins: { editorSaveHook: call } }
    })
    formatter.mockReturnValue(Promise.resolve('formatted content'))
    await expect(editorSaveTransform(store, file, request(), 'original text')).resolves.toBe(
      'formatted content'
    )
    expect(call).not.toHaveBeenCalled()
  })

  it('removes the unregistered general application-plugin save and denial source', () => {
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/renderer/src/components/editor/save/transforms/editor-save-plugin-hook.ts'
        )
      )
    ).toBe(false)
    const pipeline = readFileSync(
      resolve(
        process.cwd(),
        'src/renderer/src/components/editor/save/transforms/editor-save-transform-pipeline.ts'
      ),
      'utf8'
    )
    const attempt = readFileSync(
      resolve(
        process.cwd(),
        'src/renderer/src/components/editor/save/commands/editor-file-save-attempt.ts'
      ),
      'utf8'
    )
    expect(pipeline).not.toMatch(/editorSavePluginHook|editor-save-plugin-hook/)
    expect(pipeline).toContain('editorFormatOnSave(')
    expect(pipeline).toContain('EditorSaveDiscardedError')
    expect(attempt).not.toMatch(/EditorSaveDeniedByPluginError|editor-save-plugin-hook/)
    expect(attempt).toContain('EDITOR_STALE_SAVE_MESSAGE')
    expect(attempt).toContain('EDITOR_NOT_UTF8_SAVE_MESSAGE')
  })
})
