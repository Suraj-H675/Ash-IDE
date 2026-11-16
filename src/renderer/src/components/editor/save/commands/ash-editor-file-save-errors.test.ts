// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { requestEditorFileSave, type EditorSaveFileTarget } from '../../autosave/editor-autosave'
import { attemptEditorFileSave } from './editor-file-save-attempt'
import {
  EDITOR_NOT_UTF8_SAVE_MESSAGE,
  EDITOR_STALE_SAVE_MESSAGE
} from '../queue/editor-save-disk-precondition'
import { FILE_BYTES_SAVE_UPDATE_REQUIRED_MESSAGE } from '../../../../../../shared/file-bytes-write'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('../../autosave/editor-autosave', () => ({
  requestEditorFileSave: vi.fn()
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const save = vi.mocked(requestEditorFileSave)
const errorToast = vi.mocked(toast.error)
const target: EditorSaveFileTarget = { fileId: 'original-source' }

beforeEach(() => {
  save.mockReset()
  errorToast.mockReset()
})

describe('Ash editor save errors without an app-plugin denial type', () => {
  it('saves the original target successfully', async () => {
    save.mockResolvedValue(undefined as never)
    await expect(attemptEditorFileSave(target)).resolves.toBe(true)
    expect(save).toHaveBeenCalledExactlyOnceWith(target)
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation before converting invalid UTF-8', async () => {
    const confirm = vi.fn(async () => true)
    save.mockRejectedValueOnce(new Error(EDITOR_NOT_UTF8_SAVE_MESSAGE))
    save.mockResolvedValueOnce(undefined as never)
    await expect(attemptEditorFileSave(target, confirm)).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(1, target)
    expect(save).toHaveBeenNthCalledWith(2, { ...target, convertToUtf8: true })
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('does not rewrite invalid UTF-8 when confirmation is declined', async () => {
    const confirm = vi.fn(async () => false)
    save.mockRejectedValueOnce(new Error(EDITOR_NOT_UTF8_SAVE_MESSAGE))
    await expect(attemptEditorFileSave(target, confirm)).resolves.toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(errorToast).not.toHaveBeenCalled()
  })

  it.each([EDITOR_STALE_SAVE_MESSAGE, FILE_BYTES_SAVE_UPDATE_REQUIRED_MESSAGE])(
    'preserves the specific refusal notice for %s',
    async (message) => {
      save.mockRejectedValueOnce(new Error(message))
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await expect(attemptEditorFileSave(target)).resolves.toBe(false)
        expect(errorToast).toHaveBeenCalledWith(message)
      } finally {
        consoleError.mockRestore()
      }
    }
  )

  it('does not present a legacy plugin-specific denial as an active app-plugin feature', async () => {
    save.mockRejectedValueOnce(new Error('Untrusted plugin refused this save'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(attemptEditorFileSave(target)).resolves.toBe(false)
      expect(errorToast).toHaveBeenCalledWith('Failed to save the file. Please try again.')
    } finally {
      consoleError.mockRestore()
    }
  })
})
