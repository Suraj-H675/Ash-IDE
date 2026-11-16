// @vitest-environment happy-dom
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { EditorEditFileSurface } from './EditorEditFileSurface'
import { getEditorPanelRenderModel } from './editor-panel-render-model'

vi.mock('./editor-lazy-views', () => ({
  MonacoEditor: () => <div>Built-in Monaco source</div>,
  CsvViewer: () => <div>Built-in CSV viewer</div>,
  CsvPagedViewer: () => <div>Built-in paged CSV viewer</div>,
  ImageViewer: () => <div>Built-in image viewer</div>,
  IpynbViewer: () => <div>Built-in notebook viewer</div>,
  MermaidViewer: () => <div>Built-in diagram viewer</div>,
  MediaViewer: () => <div>Built-in media viewer</div>
}))
vi.mock('./PluginCustomEditorFrame', () => ({
  default: () => <div>Excluded injected plugin frame</div>
}))
vi.mock('./PluginBytesCustomEditorSurface', () => ({
  default: () => <div>Excluded injected byte editor</div>
}))
vi.mock('../error-boundaries/RecoverableRenderErrorBoundary', () => ({
  RecoverableRenderErrorBoundary: ({ children }: { children: React.ReactNode }) => children
}))

afterEach(() => vi.unstubAllGlobals())

function rendererSource(path: string): string {
  return readFileSync(resolve(process.cwd(), 'src/renderer/src', path), 'utf8')
}

const activeFile = {
  id: 'file-1',
  mode: 'edit',
  filePath: '/tmp/source.ts',
  relativePath: 'source.ts',
  worktreeId: 'local-workspace',
  language: 'typescript'
} as OpenFile

const surfaceProps = {
  activeFile,
  viewStateScopeId: 'view-1',
  editorViewStateKey: 'view-state',
  diffViewStateKey: 'diff-state',
  pdfViewStateKey: 'pdf-state',
  pdfPreferenceKey: 'pdf-key',
  fileContent: { content: 'const n = 1', isBinary: false },
  diffContent: undefined,
  editBuffer: undefined,
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

const injectedPluginEditor = {
  key: 'injected/custom',
  title: 'Dangerous Custom Editor',
  contentKind: 'text',
  pluginKey: 'injected',
  priority: 'default',
  frame: 'isolated'
}

describe('Ash routes files exclusively through built-in editor/viewers', () => {
  it('ignores a synthetic legacy custom-frame prop on a text editor surface', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <EditorEditFileSurface
            {...({ ...surfaceProps, customEditor: injectedPluginEditor } as ComponentProps<
              typeof EditorEditFileSurface
            >)}
          />
        )
      })
      expect(host.textContent).toContain('Built-in Monaco source')
      expect(host.textContent).not.toContain('Excluded injected plugin frame')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('does not turn a binary document into an injected plugin byte editor', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <EditorEditFileSurface
            {...({
              ...surfaceProps,
              customEditor: { ...injectedPluginEditor, contentKind: 'bytes' },
              fileContent: { content: '', isBinary: true, byteSource: { kind: 'local' } }
            } as unknown as ComponentProps<typeof EditorEditFileSurface>)}
          />
        )
      })
      expect(host.textContent).toContain('Binary file')
      expect(host.textContent).not.toContain('Excluded injected byte editor')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it.each([
    ['source.ts', 'typescript', ['edit', 'changes']],
    ['readme.md', 'markdown', ['source', 'rich', 'changes']],
    ['data.csv', 'csv', ['source', 'rich', 'changes']],
    ['diagram.svg', 'svg', ['source', 'rich', 'changes']],
    ['notebook.ipynb', 'notebook', ['source', 'rich']]
  ])(
    'keeps built-in modes for %s even when plugin editors are injected',
    (file, language, modes) => {
      const model = getEditorPanelRenderModel({
        activeFile: { ...activeFile, filePath: `/tmp/${file}`, relativePath: file, language },
        fileContents: { 'file-1': { content: 'test', isBinary: false } },
        editorDrafts: {},
        gitStatusEntries: [],
        gitBranchEntries: [],
        markdownViewMode: {},
        isChangesMode: false,
        canOpenWorkspaceFileBrowser: false,
        customEditors: [injectedPluginEditor],
        customEditorChoice: injectedPluginEditor.key
      } as never)
      expect(model.availableEditorToggleModes).toEqual(modes)
      expect(model.effectiveToggleValue).not.toMatch(/plugin-editor:/)
      expect(model).not.toHaveProperty('activeCustomEditor')
    }
  )

  it('eliminates active plugin-frame selection and tab-icon paths, preserving built-in views', () => {
    for (const path of [
      'components/editor/EditorPanel.tsx',
      'components/editor/editor-panel-render-model.ts',
      'components/editor/EditorEditFileSurface.tsx',
      'components/editor/EditorContent.tsx',
      'components/editor/view-mode/EditorViewToggle.tsx',
      'components/editor/EditorPanelHeader.tsx',
      'components/tab-bar/EditorFileTab.tsx'
    ]) {
      expect(rendererSource(path), path).not.toMatch(
        /useFileCustomEditors|useTabCustomEditor|PluginCustomEditorFrame|PluginBytesCustomEditorSurface|resolveCustomEditorToggle|customEditorToggleValue|CustomEditorToggleValue|PluginContributionIcon|plugin-editor:/
      )
    }
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/renderer/src/components/editor/view-mode/custom-editor-toggle.ts'
        )
      )
    ).toBe(false)
    const surface = rendererSource('components/editor/EditorEditFileSurface.tsx')
    expect(surface).toContain('<MonacoEditor')
    expect(surface).toContain('<ImageViewer')
    expect(surface).toContain('<MediaViewer')
    expect(surface).toContain('<CsvViewer')
    expect(surface).toContain('<IpynbViewer')
    expect(surface).toContain('<MermaidViewer')
  })
})
