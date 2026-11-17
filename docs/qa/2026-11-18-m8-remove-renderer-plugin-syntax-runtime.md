# M8 renderer plugin syntax runtime retirement

Date: 2026-11-18
Base: `501da99c4751548f9f6869d7acf43208f54ab713`
Branch: `fix/m8-remove-plugin-syntax-runtime`

## Scope

Removed the renderer application-plugin syntax runtime and its stores:

- `src/renderer/src/components/editor/use-plugin-syntax-language.ts`
- `src/renderer/src/lib/monaco-languages/plugin-grammar-protocol.ts`
- `src/renderer/src/lib/monaco-languages/plugin-grammar-tokenization.ts`
- `src/renderer/src/lib/monaco-languages/plugin-grammar-worker-client.ts`
- `src/renderer/src/lib/monaco-languages/plugin-grammar.worker.ts`
- `src/renderer/src/lib/monaco-languages/plugin-syntax-editor-options.ts`
- `src/renderer/src/lib/monaco-languages/plugin-syntax-engine.ts`
- `src/renderer/src/lib/monaco-languages/plugin-syntax-runtime.ts`
- `src/renderer/src/lib/monaco-languages/plugin-syntax-slot-pool.ts`
- `src/renderer/src/lib/monaco-languages/plugin-syntax-token-legend.ts`
- `src/renderer/src/store/plugin-syntax-failures.ts`
- `src/renderer/src/store/plugin-syntax-packs.ts`

`MonacoEditor`, `DiffSectionBody`, and `DiffViewer` now pass their supplied core language to Monaco directly. File type detection, Unicode highlighting, model ownership, diff comments, word wrap, and the other editor lifecycle behavior remain in place.

## Retained behavior and boundaries

`monaco-setup.ts` and its built-in registrations are unchanged: Vue, Svelte, Astro, Glimmer, CUDA, Nim, Lean, Typst, Zig, Groovy, CMake, JSONL, dotenv, Quarto, Markdown, and shell Markdown aliases.

This slice leaves the main app-plugin backend, IPC/RPC/preload surfaces, shared plugin artifact schema, syntax and language-pack registries, language-pack store, themes, and terminal token rules in place. The syntax-and-language-packs source route no longer selects the retired renderer syntax contribution and stores; it retains the language-pack store and main/shared registry and artifact selectors.

## Verification

- Focused Vitest regression: 1 file, 3 tests passed. It checks all 12 paths are absent, the three editor components use `coreLanguage` without plugin syntax calls/options, and representative built-in Monaco registrations remain.
- No existing Monaco editor or diff viewer behavior test files were present in this worktree.
- `node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs`: passed.
- `pnpm --config.manage-package-manager-versions=false run build:desktop:assets`: passed. Vite emitted chunk-size and ineffective dynamic import warnings; the build completed successfully.
- Renderer output scan in `out/renderer`: zero occurrences of `plugin-grammar.worker`, `PluginGrammarWorkerClient`, `usePluginSyntaxLanguage`, and `loadSyntax`.
- Oxfmt `--check`, Oxlint `--deny-warnings`, `node --check` for the changed source-routing script, and `git diff --check`: passed.
- Full provenance: `node config/scripts/provenance/verify-source-ledger.mjs` — passed in the DevSpace shell; 33,506 upstream records, 662 Ash modifications, 8,854 documented removals, and pinned MIT license hash verified. A separate manual path/hash audit also passed for all 12 exclusions, the four modified-source records, all 16 built-in registration imports/calls, and the retained source-route selectors.
- No AppImage build or GUI lifecycle was run for this focused renderer slice.

## Status

M8 remains incomplete. This change only retires the renderer syntax runtime; the separately scoped main, preload, backend, and shared plugin schema audit remains to be done.
