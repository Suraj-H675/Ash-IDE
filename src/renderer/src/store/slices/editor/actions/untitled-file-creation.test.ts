import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertEditorFileOperationCurrent,
  captureEditorFileOperationProvenance,
  getEditorFileOperationContext
} from '@/lib/editor-file-operation-owner'
import { createUntitledMarkdownFile } from '@/lib/create-untitled-markdown'
import { createUntitledFileActions } from './untitled-file-creation'

vi.mock('@/lib/editor-file-operation-owner', () => ({
  assertEditorFileOperationCurrent: vi.fn(),
  captureEditorFileOperationProvenance: vi.fn(),
  getEditorFileOperationContext: vi.fn()
}))

vi.mock('@/lib/create-untitled-markdown', () => ({
  createUntitledMarkdownFile: vi.fn()
}))

describe('generic untitled file actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a blank file under the captured current workspace owner and opens it as permanent', async () => {
    const operationProvenance = { generation: { route: {} } } as never
    const target = { kind: 'local' } as never
    const operationContext = {
      connectionId: 'connection-1',
      target,
      expectedExecutionHostId: 'local' as const
    }
    const state = {
      activeWorktreeId: 'worktree-1',
      getKnownWorktreeById: vi.fn(() => ({ path: '/workspace' })),
      openFile: vi.fn()
    }
    const get = vi.fn(() => state)
    const createdFile = {
      filePath: '/workspace/untitled.txt',
      relativePath: 'untitled.txt',
      worktreeId: 'worktree-1',
      language: 'plaintext',
      isUntitled: true as const,
      mode: 'edit' as const
    }

    vi.mocked(captureEditorFileOperationProvenance).mockReturnValue(operationProvenance)
    vi.mocked(getEditorFileOperationContext).mockReturnValue(operationContext as never)
    vi.mocked(createUntitledMarkdownFile).mockImplementation(
      async (_path, _worktreeId, _connectionId, _target, options) => {
        options?.assertOperationCurrent?.()
        return createdFile
      }
    )

    const actions = createUntitledFileActions(vi.fn() as never, get as never)
    await actions.openBlankFileInActiveWorkspace('.txt')

    expect(captureEditorFileOperationProvenance).toHaveBeenCalledWith(
      state,
      'worktree-1',
      undefined,
      false
    )
    expect(getEditorFileOperationContext).toHaveBeenCalledWith(
      state,
      { worktreeId: 'worktree-1', operationProvenance },
      '/workspace'
    )
    expect(createUntitledMarkdownFile).toHaveBeenCalledWith(
      '/workspace',
      'worktree-1',
      'connection-1',
      target,
      expect.objectContaining({
        newFile: { extension: '.txt', content: '' },
        operationProvenance,
        expectedExecutionHostId: 'local'
      })
    )
    expect(assertEditorFileOperationCurrent).toHaveBeenCalledWith(
      state,
      'worktree-1',
      operationProvenance
    )
    expect(state.openFile).toHaveBeenCalledWith(createdFile, {
      preview: false,
      targetGroupId: undefined,
      focusEditor: true
    })
  })
})
