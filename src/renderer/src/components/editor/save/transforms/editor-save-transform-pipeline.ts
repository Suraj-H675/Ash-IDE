import type { OpenFile } from '@/store/slices/editor/types/open-file'
import type { AppStoreApi } from '../queue/editor-save-queue-contract'
import type { EditorSaveRequest } from '../queue/editor-save-slots'
import { EditorSaveDiscardedError, editorDiscardEpoch } from '../flush/editor-discard-epoch'
import { editorFormatOnSave } from './editor-format-on-save'

export function editorSaveTransform(
  store: AppStoreApi,
  file: OpenFile,
  request: EditorSaveRequest,
  text: string
): Promise<string> | null {
  if (!('operation' in request.invocation)) {
    throw request.invocation.error
  }
  const { operation } = request.invocation
  return editorFormatOnSave(store, file, operation.mutationContext(), request.trigger, text, () => {
    operation.assertAuthorityCurrent()
    if (editorDiscardEpoch(request.recordId) !== request.discardEpoch) {
      throw new EditorSaveDiscardedError()
    }
  })
}
