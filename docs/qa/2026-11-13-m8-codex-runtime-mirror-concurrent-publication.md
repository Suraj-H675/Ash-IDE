# M8 — Guard managed Codex config publication against concurrent writes

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `8b12166ea83f87855b49ba50799b4f67b8706d60` (GitHub Actions run `43394865041`: success).
**Worktree branch:** `fix/m8-codex-runtime-mirror-cas` in the existing isolated Codex-settings worktree.

## Finding

Even when settings promotion and mirroring succeeded, the managed Codex `config.toml` was written using an unconditional atomic rename. A concurrent Codex process could create the config between the initial absent-file observation and first mirror, or edit a present config between read and publication; either change was silently replaced. This could discard concurrent model edits or recently written project-trust decisions.

## Correction

Both fresh-home and existing-file mirror publications use the established guarded, owner-only `writeFileAtomicallyIfUnchanged()` operation through a small `codex-config-mirror-publication` helper. A first mirror may publish only if the file remains absent; a subsequent mirror may replace only the exact observed content. On a lost race, mirroring fails into the previously verified native project distrust fallback. Native Codex settings are not modified by this mechanism, and a concurrently written Ash runtime scalar is preserved while explicit native `untrusted` project entries can still be synchronized.

## Evidence

- **Red-first regressions** failed on the unconditional publication: a concurrent local model update during native project revocation was overwritten, and a concurrently created first-runtime config was overwritten. Both pass with guarded publication.
- Focused Codex configuration and unreadable-runtime tests: **62 passed across 11 files**.
- Expanded Codex settings, hooks, trust, and runtime-account tests: **311 passed, 15 platform-specific skips across 62 files**.
- WSL/home-routing fixtures: **18 passed across six files**, not live WSL guest execution.
- Targeted lint and formatting: passed. Node TypeScript, provenance, post-integration builds, and new CI are recorded separately once observed.
- Tests use disposable Ash and provider homes with injected interleavings. They do not touch native user credentials or account settings and do not constitute a real signed-in Codex session.

## Remaining acceptance gates

Provider trust can change after the snapshot and other providers may have different mutation paths. Runtime publication on file systems without the required guarded hard-link operations may refuse sync rather than silently overwrite, requiring platform-specific validation. Packaged desktop and signed-in-provider workflows remain separate M8 gates.
