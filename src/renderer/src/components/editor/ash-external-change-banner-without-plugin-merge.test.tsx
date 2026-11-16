// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { EditorEditFileSurface } from './EditorEditFileSurface'

vi.mock('./editor-lazy-views', () => ({
  MonacoEditor: () => <div>Built-in text editor</div>,
  CsvViewer: () => <div>Built-in CSV viewer</div>,
  CsvPagedViewer: () => <div>Built-in paged CSV viewer</div>,
  ImageViewer: () => <div>Built-in image viewer</div>,
  IpynbViewer: () => <div>Built-in notebook viewer</div>,
  MermaidViewer: () => <div>Built-in diagram viewer</div>,
  MediaViewer: () => <div>Built-in media viewer</div>
}))
vi.mock('../error-boundaries/RecoverableRenderErrorBoundary', () => ({
  RecoverableRenderErrorBoundary: ({ children }: { children: React.ReactNode }) => children
}))

const file: OpenFile = {
  id: 'local-draft',
  filePath: '/work/project/notes.ts',
  relativePath: 'notes.ts',
  worktreeId: 'local-project',
  mode: 'edit',
  language: 'typescript',
  externalMutation: 'changed',
  isDirty: true
} as OpenFile

const props = {
  activeFile: file,
  viewStateScopeId: file.id,
  editorViewStateKey: file.id,
  diffViewStateKey: file.id,
  pdfViewStateKey: file.id,
  pdfPreferenceKey: file.id,
  fileContent: { content: 'const saved = 1', isBinary: false },
  editBuffer: 'const draft = 2',
  diffContent: undefined,
  activeConflictEntry: null,
  monacoLanguage: 'typescript',
  isMarkdown: false,
  isMermaid: false,
  isSvg: false,
  isCsv: false,
  isNotebook: false,
  mdViewMode: 'source',
  inlineMarkdownRenderState: null,
  isChangesMode: false,
  sideBySide: false,
  showMarkdownTableOfContents: false,
  showMarkdownFrontmatter: false,
  onCloseMarkdownTableOfContents: () => {},
  markdownAnnotationsEnabled: false,
  pendingEditorReveal: null,
  markdownDocuments: {},
  getConflictNavigation: () => undefined,
  getMarkdownSourceLineOffset: () => 0,
  handleContentChange: () => {},
  handleDirtyStateHint: () => {},
  handleSave: async () => true,
  reloadContent: () => {}
} as unknown as ComponentProps<typeof EditorEditFileSurface>

async function renderSurface(overrides: Partial<typeof props>): Promise<{
  host: HTMLDivElement
  unmount: () => Promise<void>
}> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<EditorEditFileSurface {...props} {...overrides} />))
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    }
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Ash external file changes always use the built-in recovery warning', () => {
  it('shows the real disk-conflict warning with compare, reload and keep options', async () => {
    const view = await renderSurface({})
    try {
      expect(view.host.querySelector('[role="alert"]')).not.toBeNull()
      expect(view.host.textContent).toContain('This file changed on disk')
      expect(view.host.textContent).toContain('Reload from Disk')
      expect(view.host.textContent).toContain('Compare')
      expect(view.host.textContent).toContain('Keep My Edits')
      expect(view.host.textContent).toContain('Built-in text editor')
    } finally {
      await view.unmount()
    }
  })

  it('does not show a disk-conflict warning on an unmodified file', async () => {
    const view = await renderSurface({
      activeFile: { ...file, externalMutation: undefined, isDirty: false }
    })
    try {
      expect(view.host.querySelector('[role="alert"]')).toBeNull()
      expect(view.host.textContent).toContain('Built-in text editor')
    } finally {
      await view.unmount()
    }
  })

  it('no longer delegates warning suppression or file rendering to plugin frame hosts', () => {
    const renderer = 'src/renderer/src/components/editor/'
    for (const path of [
      'PluginBytesCustomEditorSurface.tsx',
      'PluginCustomEditorFrame.tsx',
      'PluginEditorNeedsDesktopNotice.tsx',
      'plugin-custom-editor-frame-events.ts',
      'plugin-custom-editor-host.ts',
      'plugin-custom-editor-outside-merge.ts',
      'use-custom-editor-outside-merge.ts',
      'use-custom-editor-reload-flush.ts',
      'external-changes/CustomEditorExternalChangeBanner.tsx'
    ]) {
      expect(existsSync(resolve(process.cwd(), renderer, path)), path).toBe(false)
    }
    const activeSurface = readFileSync(
      resolve(process.cwd(), renderer, 'EditorEditFileSurface.tsx'),
      'utf8'
    )
    expect(activeSurface).toContain("from './external-changes/ExternalFileChangeBanner'")
    expect(activeSurface).toContain('<ExternalFileChangeBanner')
    expect(activeSurface).not.toMatch(/useCustomEditorMerging|CustomEditorExternalChangeBanner/)
    for (const retained of [
      'save/bytes/editor-bytes-documents.ts',
      'save/bytes/editor-bytes-document-boxes.ts',
      'plugin-custom-editor-host-types.ts',
      'external-changes/ExternalFileChangeBanner.tsx',
      'save/queue/editor-save-queue.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), renderer, retained)), retained).toBe(true)
    }
  })
})
