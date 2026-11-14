# M8 / BR-01, BR-02, PK-03 — native X11 packaged browser and guarded close journey

**Date:** 2026-11-14 (Asia/Kolkata). **Base:** canonical clean `main` at `f2ad47ae8f46da73a22c8f4e7c7dc12caa1f2fbe`, GitHub Actions run `43559269231` successful. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-020c66c5`, branch `test/m8-x11-packaged-browser-local-navigation`. **Pinned Orca source:** `55697aec91390357540103f49991458f756b41cc`, unchanged MIT source ledger.

## Scenario and scope

- Expanded the existing private, opt-in native-X11 AppImage lifecycle harness with `ASH_TEST_BROWSER_SMOKE=1`. The new `ash-packaged-browser-local-smoke.cjs` uses a fresh, mode-0700, marker-verified `/var/tmp/ashx11.XXXXXX` fixture and independent Ash runtime/profile. Its small HTTP server binds **only** to ephemeral `127.0.0.1` and serves two deterministic, unsigned-in HTML pages. It cannot create a server or write a fixture file without the exact private profile/ownership guard.
- While the real packaged Electron GUI runs under authenticated native Xvfb, the test uses the existing packaged RPC client to create a browser tab, obtain a real DOM snapshot, click `#activate` with `browser.click` and an exact expected-URL guard, read back the changed text with `browser.eval`, navigate to `/next` via `browser.goto`, and snapshot the second page. A browser response is not substituted with a mocked backend.
- The CLI creates a native `sleep 120` PTY in the same test-owned original folder. With a workbench/browser tab now active, the genuine **running-terminal close guard** prevents immediate GUI closure. The driver proves the runtime remains ready, then uses an extended Xlib/XTest helper to press Return on the test-owned Ash top-level, confirming the dialog's auto-focused destructive Close button. The helper checks matching X11 WM_CLASS, process identity and disposable XAUTHORITY/profile path; it does not inject into the user's real desktop.
- After GUI closure the same app PID, runtime ID and native PTY remain reachable. On reopening, the test verifies the original browser page ID and URL persist **and performs another real DOM snapshot** of the second page. It verifies that a new X11 top-level belongs to the original Ash process, then explicitly stops the test-owned daemon/runtime and loopback HTTP child.
- `ASH_TEST_BROWSER_SMOKE` defaults to off. Both the original X11 PTY smoke and Wayland smoke retain their existing stronger baseline path. The network-audit wrapper pins `ASH_TEST_BROWSER_SMOKE=0`, so an unrelated ambient opt-in cannot change its Wayland-only capture boundary.

## Actual QA evidence

- **First observed failure was meaningful:** browser page creation, snapshot, evaluation and navigation succeeded, but the original test expected a window with running PTY to close without user confirmation; after receiving `WM_DELETE_WINDOW`, the real runtime correctly stayed `ready`. The test now honors the existing explicit close dialog instead of weakening it, force-destroying the window or pretending the prompt is absent.
- **Real browser click + guarded window-close run PASS**, private fixture `/var/tmp/ashx11.z0w4zR`. Subsequent **browser snapshot after GUI reattachment PASS**, private fixture `/var/tmp/ashx11.leygn3`.
- **Final source/fixture ownership guard rerun PASS**, `/var/tmp/ashx11.ZRUZLc`: browser page ID `dd8cfdae-5a6d-4f13-abcf-1a9e0421ef48` retained across GUI closure/reopen; first page snapshot, real click, DOM evaluation, second page navigation and post-reopen second-page snapshot all returned success. X11 original top-level `0x200003`, reattached top-level `0x200019`, both class `com.ashide.desktop`, app PID **`340568`**. Runtime ID **`6e455024-971a-4a30-8ef5-89b1612db2af`**, terminal handle **`term_fc62386e-f665-4f6a-875b-29f5c077db59`**, live PTY PID **`341275`** stayed identical across closing/reopening. Authenticated running-work guard reported `ready` until XTest Return confirmed the close. All test-owned processes were stopped afterward.
- Native X11 1280×800 pre/post screenshots were captured inside the private fixture (939 and 991 distinct colors); they are evidence of rendered pixels, **not** an Orca visual-parity approval. Test URL was loopback-only, **not** proof that Chromium makes no background external requests. Earlier EX-09 netlog independently observed Chromium component and GitHub traffic.
- **Default native X11 regression PASS** with the browser opt-in absent: `/var/tmp/ashx11.uKwHJ9`, app PID `342120`, runtime ID `e31c7bc8-5ebf-47ef-8ced-1046fc9db2df`, terminal handle `term_2aa497a9-28a2-4102-88c2-3b4998fc7bb3`, terminal PID `342662`. **Native Wayland regression PASS** with the browser opt-in absent: `/var/tmp/ashwl.pLxnTo`, app PID `343953`, runtime ID `43c2dc7b-40f8-466c-8d16-4669f598ad71`, terminal handle `term_ab5cce0c-aea4-49f7-b25e-c1ffed4ef6e3`, PTY PID `344552`. No tested app or terminal child remained running after fixture cleanup.
- The test fixture rejects an invalid root (`serve .` returned nonzero) rather than creating a local server inside a working repository. New browser script syntax and formatting checked; source-level provenance check still validates the pinned Orca inventory.
- **Targeted surrounding Vitest PASS: 57/57 tests across 4 files**, exercising the browser CLI, browser RPC dispatcher/automation boundaries and running-work window close behavior. **Full `pnpm run typecheck`: PASS**. Updated Xlib/XTest native helper compilation with all warnings promoted to errors: **PASS**. Bash syntax, Node CJS syntax, new QA-script lint and formatting and `git diff --check`: **PASS**. Pinned source ledger: **33,506** upstream records, **583** tracked Ash adaptations and **8,567** documented upstream exclusions, with the original MIT license SHA-256 retained.
- Packaged artifact: existing `dist/ash-ide-linux.AppImage`, 224,358,840 bytes, SHA-256 **`a7b0e3b6854a53f9a66f85735ce4b60da9a8cf8c808bbb4c281f5c7edd5c50a1`**. This milestone changes **QA code only**, not the shipped app or binary. Xlib/XTest helper compiled on the QA host with `-std=c11 -Wall -Wextra -Werror` and explicit `-lX11 -lXtst`.

## Limits

- BR-01 and BR-02 now have positive native-X11 local-server/tab/DOM-action evidence. This does **not** cover Design Mode, full browser profile and extension behavior, GUI-less automation without X11, OS clipboard copy/paste, notifications, window-manager interactions, all browser errors, or remote provider credentials. These acceptance gates remain open.
- Synthetic Return is constrained to the test's private Xvfb session; it exercises a real modal interaction but does **not** demonstrate accessible keyboard focus/labels on every desktop environment. No real provider agent was launched, no user repository/profile was opened, and no release/rollback was performed.
- CI for the integrated commit must be observed separately; the earlier passing `f2ad47ae` run is the baseline, not a forecast of new CI success.

## Repeat on the Arch QA host

```bash
TMPDIR=/var/tmp TEMP=/var/tmp TMP=/var/tmp \
  ASH_TEST_BROWSER_SMOKE=1 ASH_TEST_CAPTURE_X11_SCREENSHOT=1 \
  config/scripts/desktop-distribution/runtime-verification/verify-linux-appimage-x11-lifecycle.sh \
  "$PWD/dist/ash-ide-linux.AppImage"
```

Requires the matching packaged `dist/linux-unpacked` helpers, Xvfb/Xauth, host Xlib **and** XTest development headers/libraries, a C compiler, and ImageMagick for optional screenshots. Raw CLI status, Chromium/browser fixtures and screenshots stay inside mode-0700 disposable QA directories and are not checked into the public repository.
