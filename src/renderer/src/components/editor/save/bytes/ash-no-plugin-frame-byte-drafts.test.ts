import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bytesDocumentBoxes,
  rekeyEditorBytesDocuments,
  type CustomEditorBinaryDocument
} from './editor-bytes-document-boxes'

const files = [
  'src/renderer/src/components/editor/plugin-custom-editor-host-types.ts',
  'src/renderer/src/components/right-sidebar/plugin-panels/health/plugin-panel-watchdog.ts',
  'src/renderer/src/components/status-bar/PluginStatusBarItems.tsx',
  'src/renderer/src/store/plugin-status-bar-items.ts',
  'src/renderer/src/components/plugins/frames/plugin-frame-element.tsx',
  'src/renderer/src/components/plugins/frames/plugin-frame-host-lanes.ts',
  'src/renderer/src/components/plugins/frames/plugin-frame-host.ts',
  'src/renderer/src/components/plugins/frames/plugin-panel-design-token-css.ts',
  'src/renderer/src/components/plugins/frames/use-plugin-frame-entry.ts',
  'src/renderer/src/components/plugins/frames/use-plugin-frame-host.ts',
  'src/renderer/src/components/plugins/frames/use-plugin-panel-theme-revision.ts'
]

const testIds = ['ash-guest-draft-before', 'ash-guest-draft-after', 'ash-guest-draft-swap']
const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

afterEach(() => {
  for (const id of testIds) {
    bytesDocumentBoxes.delete(id)
  }
})

describe('Ash removes orphan plugin guest frames without losing binary drafts', () => {
  it('removes the excluded frame, watchdog and status-bar modules', () => {
    for (const file of files) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(false)
    }
    const status = source('src/renderer/src/components/status-bar/StatusBarSurface.tsx')
    expect(status).toContain('NativeChatResumeStatusSegment')
    expect(status).toContain('ProviderSegment')
    expect(status).toContain('ClaudeSwitcherMenu')
    expect(status).toContain('CodexSwitcherMenu')
    expect(status).not.toContain('PluginStatusBarItems')
  })

  it('retains binary document data types in the local draft box rather than the removed plugin host', () => {
    const box = source(
      'src/renderer/src/components/editor/save/bytes/editor-bytes-document-boxes.ts'
    )
    const documents = source(
      'src/renderer/src/components/editor/save/bytes/editor-bytes-documents.ts'
    )
    expect(box).toContain('export type CustomEditorBinaryDocument')
    expect(box).toContain('bytesDocumentBoxes')
    expect(documents).toContain('saveEditorBytesDraft')
    expect(documents).toContain('hasEditorBytesDraft')
    expect(documents).toContain('recordSelfWrite')
    expect(documents).toContain('assertWriterCurrent')
    expect(box).not.toContain('plugin-custom-editor-host-types')
    expect(documents).not.toContain('plugin-custom-editor-host-types')
  })

  it('preserves an unsaved byte draft when the original file ID changes', () => {
    const saved: CustomEditorBinaryDocument = {
      bytes: new Uint8Array(new ArrayBuffer(2)),
      fileType: 'application/octet-stream'
    }
    saved.bytes.set([1, 2])
    const draft: CustomEditorBinaryDocument = {
      bytes: new Uint8Array(new ArrayBuffer(3)),
      fileType: saved.fileType
    }
    draft.bytes.set([3, 4, 5])
    const box = { current: { saved, savedSha256: 'saved-sha', draft }, edits: 4 }
    bytesDocumentBoxes.set(testIds[0], box)
    rekeyEditorBytesDocuments([{ oldFileId: testIds[0], newFileId: testIds[1] }])
    expect(bytesDocumentBoxes.has(testIds[0])).toBe(false)
    expect(bytesDocumentBoxes.get(testIds[1])).toBe(box)
    expect(bytesDocumentBoxes.get(testIds[1])?.current.saved.bytes).toEqual(Uint8Array.from([1, 2]))
    expect(bytesDocumentBoxes.get(testIds[1])?.current.draft?.bytes).toEqual(
      Uint8Array.from([3, 4, 5])
    )
    expect(bytesDocumentBoxes.get(testIds[1])?.edits).toBe(4)
  })

  it('preserves distinct binary drafts on simultaneous file-ID swaps', () => {
    const makeBox = (value: number) => ({
      current: {
        saved: {
          bytes: Uint8Array.from([value]),
          fileType: 'application/octet-stream'
        },
        savedSha256: String(value),
        draft: {
          bytes: Uint8Array.from([value + 1]),
          fileType: 'application/octet-stream'
        }
      },
      edits: value
    })
    const first = makeBox(10)
    const second = makeBox(20)
    bytesDocumentBoxes.set(testIds[0], first)
    bytesDocumentBoxes.set(testIds[2], second)
    rekeyEditorBytesDocuments([
      { oldFileId: testIds[0], newFileId: testIds[2] },
      { oldFileId: testIds[2], newFileId: testIds[0] }
    ])
    expect(bytesDocumentBoxes.get(testIds[0])).toBe(second)
    expect(bytesDocumentBoxes.get(testIds[2])).toBe(first)
    expect(bytesDocumentBoxes.get(testIds[0])?.current.draft?.bytes).toEqual(Uint8Array.from([21]))
    expect(bytesDocumentBoxes.get(testIds[2])?.current.draft?.bytes).toEqual(Uint8Array.from([11]))
  })
})
