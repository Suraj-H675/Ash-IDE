// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSettingsNavigationTarget } from '@/lib/settings-navigation-types'
import { EditorEditFileSurface } from './EditorEditFileSurface'

vi.mock('./editor-lazy-views', () => ({
  MonacoEditor: () => <div>Retained Monaco editor</div>,
  CsvViewer: () => <div>CSV retained</div>,
  CsvPagedViewer: () => <div>CSV preview retained</div>,
  ImageViewer: () => <div>Image preview retained</div>,
  IpynbViewer: () => <div>Notebook retained</div>,
  MermaidViewer: () => <div>Mermaid retained</div>,
  MediaViewer: () => <div>Media retained</div>
}))
vi.mock('./PluginEditorNeedsDesktopNotice', () => ({
  PluginEditorSourceFallbackNotice: () => <div>Orca plugin editor notice</div>
}))
vi.mock('../error-boundaries/RecoverableRenderErrorBoundary', () => ({
  RecoverableRenderErrorBoundary: ({ children }: { children: React.ReactNode }) => children
}))

afterEach(() => vi.unstubAllGlobals())

function readRenderer(path: string): string {
  return readFileSync(resolve(process.cwd(), 'src/renderer/src', path), 'utf8')
}

const base = {
  activeFile: {
    id: 'file-1',
    filePath: '/tmp/fixture.bin',
    relativePath: 'fixture.bin',
    worktreeId: 'synthetic-1',
    mode: 'edit'
  } as never,
  viewStateScopeId: 'scope-1',
  editorViewStateKey: 'editor-1',
  diffViewStateKey: 'diff-1',
  pdfViewStateKey: 'pdf-1',
  pdfPreferenceKey: 'pdf-pref',
  fileContent: { content: '', isBinary: true },
  diffContent: undefined,
  editBuffer: undefined,
  activeConflictEntry: null,
  monacoLanguage: 'plaintext',
  isMarkdown: false,
  isMermaid: false,
  isCsv: false,
  isNotebook: false,
  customEditor: null,
  mdViewMode: 'source' as const,
  inlineMarkdownRenderState: null,
  isChangesMode: false,
  sideBySide: false,
  showMarkdownTableOfContents: false,
  showMarkdownFrontmatter: false,
  onCloseMarkdownTableOfContents: () => {},
  markdownAnnotationsEnabled: false,
  pendingEditorReveal: null,
  markdownDocuments: {} as never,
  getConflictNavigation: () => undefined,
  getMarkdownSourceLineOffset: () => 0,
  handleContentChange: () => {},
  handleDirtyStateHint: () => {},
  handleSave: async () => true,
  reloadContent: () => {}
} satisfies React.ComponentProps<typeof EditorEditFileSurface>

describe('excluded app-plugin editor entrypoints', () => {
  it('renders the normal binary-file fallback without an app-plugin install or Orca notice', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<EditorEditFileSurface {...base} />))
      expect(host.textContent).toContain('Binary file — cannot display')
      expect(host.textContent).not.toMatch(/Install plugin|Orca plugin editor notice/i)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('keeps Monaco as the plaintext fallback without app-plugin prompts', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <EditorEditFileSurface {...base} fileContent={{ content: 'hello', isBinary: false }} />
        )
      )
      expect(host.textContent).toContain('Retained Monaco editor')
      expect(host.textContent).not.toMatch(/Install plugin|Orca plugin editor notice/i)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('does not register plugin view-request listeners from the desktop renderer lifecycle', () => {
    const lifecycle = readRenderer('hooks/ipc-events/app-lifetime-ipc-bridge.ts')
    expect(lifecycle).not.toContain('registerPluginViewIpcBridge')
    expect(lifecycle).toContain('registerBrowserRequestIpcBridge(unsubs)')
    expect(lifecycle).toContain('registerTerminalRequestIpcBridge(unsubs)')
    const editor = readRenderer('components/editor/EditorEditFileSurface.tsx')
    expect(editor).not.toMatch(/PluginFileTypeSuggestion|PluginEditorSourceFallbackNotice/)
    expect(editor).toContain('<MonacoEditor')
    expect(editor).toContain('<ImageViewer')
    expect(
      existsSync(
        resolve(process.cwd(), 'src/renderer/src/components/editor/PluginFileTypeSuggestion.tsx')
      )
    ).toBe(false)
    expect(
      existsSync(
        resolve(process.cwd(), 'src/renderer/src/hooks/ipc-events/plugin-view-ipc-bridge.ts')
      )
    ).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/preload/api/plugins-bridge.ts'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/preload/api/plugin-panel-push-bridge.ts'))).toBe(
      false
    )
  })

  it('rejects obsolete plugin Settings deep links while keeping real destinations', () => {
    expect(isSettingsNavigationTarget({ pane: 'plugins', repoId: null })).toBe(false)
    expect(isSettingsNavigationTarget({ pane: 'appearance', repoId: null })).toBe(true)
    expect(isSettingsNavigationTarget({ pane: 'git', repoId: null })).toBe(true)
    expect(isSettingsNavigationTarget({ pane: 'general', repoId: null })).toBe(true)
    expect(readRenderer('components/settings/page/settings-page-renderer.tsx')).not.toContain(
      'isWidePluginsPane'
    )
  })
})
