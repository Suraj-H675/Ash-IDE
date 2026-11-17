import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const removedRendererPaths = [
  'src/renderer/src/components/editor/use-plugin-syntax-language.ts',
  'src/renderer/src/lib/monaco-languages/plugin-grammar-protocol.ts',
  'src/renderer/src/lib/monaco-languages/plugin-grammar-tokenization.ts',
  'src/renderer/src/lib/monaco-languages/plugin-grammar-worker-client.ts',
  'src/renderer/src/lib/monaco-languages/plugin-grammar.worker.ts',
  'src/renderer/src/lib/monaco-languages/plugin-syntax-editor-options.ts',
  'src/renderer/src/lib/monaco-languages/plugin-syntax-engine.ts',
  'src/renderer/src/lib/monaco-languages/plugin-syntax-runtime.ts',
  'src/renderer/src/lib/monaco-languages/plugin-syntax-slot-pool.ts',
  'src/renderer/src/lib/monaco-languages/plugin-syntax-token-legend.ts',
  'src/renderer/src/store/plugin-syntax-failures.ts',
  'src/renderer/src/store/plugin-syntax-packs.ts'
]

const editorComponentPaths = [
  'src/renderer/src/components/editor/MonacoEditor.tsx',
  'src/renderer/src/components/editor/diff/sections/DiffSectionBody.tsx',
  'src/renderer/src/components/editor/diff/monaco-view/DiffViewer.tsx'
]

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash renderer plugin syntax runtime exclusion', () => {
  it('removes the plugin syntax runtime and its renderer stores', () => {
    for (const path of removedRendererPaths) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
  })

  it('keeps editor and diff language selection on the supplied core language', () => {
    for (const path of editorComponentPaths) {
      const source = readProjectFile(path)

      expect(source, path).not.toMatch(
        /usePluginSyntaxLanguage|PLUGIN_SYNTAX_EDITOR_OPTIONS|applyModelLanguage|window\.api\.plugins\.loadSyntax/
      )
      expect(source, path).toContain('const language = coreLanguage')
      expect(source, path).toContain('language={language}')
      expect(source, path).toContain(
        'unicodeHighlight: buildEditorUnicodeHighlightOptions(language)'
      )
    }
  })

  it('retains built-in Monaco language registrations', () => {
    const source = readProjectFile('src/renderer/src/lib/monaco-setup.ts')
    const registrations = ['Vue', 'Svelte', 'Astro', 'Markdown', 'Cuda', 'Nim', 'Typst', 'Zig']

    for (const language of registrations) {
      const registration = `register${language}Language`
      expect(source, `imports ${registration}`).toContain(`import { ${registration} }`)
      expect(source, `calls ${registration}`).toContain(`${registration}(monaco)`)
    }
  })
})
