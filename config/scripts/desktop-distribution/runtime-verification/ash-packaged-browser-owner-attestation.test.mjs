import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  new URL('./ash-packaged-browser-owner-attestation.cjs', import.meta.url),
  'utf8'
)

// Execute the actual attestation script with simulated CDP responses, without
// connecting to a real debug endpoint or creating any profile or process.
async function attest({
  stage,
  ownerId = 6,
  inaccessible = false,
  transient = false,
  actualOnly = false
}) {
  const fixture = '/tmp/ashx11.ABC123'
  const pageId = 'page-test-1234'
  const origin = 'http://127.0.0.1:32123'
  const before = {
    browserPageId: pageId,
    profileId: 'default',
    partition: 'persist:orca-browser',
    webContentsId: 2
  }
  const log = Buffer.from('DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc123\n')
  const receipts = new Map()
  const errors = []
  let attempts = 0
  let clock = 0
  const localPage = {
    evaluate: async (_fn, requestedPageId) => ({
      href: stage === 'closed' ? `${origin}/closed` : 'file:///app/index.html',
      owner:
        requestedPageId === pageId && stage !== 'closed'
          ? {
              viewportConnected: true,
              webviewPresent: true,
              webviewConnected: true,
              webviewTag: 'WEBVIEW',
              webContentsId: ownerId,
              partition: before.partition
            }
          : null
    })
  }
  const otherPage = {
    evaluate: async (_fn, requestedPageId) => {
      if (actualOnly && requestedPageId !== pageId) {
        return { href: `${origin}/local`, owner: null }
      }
      attempts += 1
      if (inaccessible || (transient && attempts === 1)) {
        throw new Error('target could not be inspected')
      }
      return { href: `${origin}/local`, owner: null }
    }
  }
  const browser = {
    contexts: () => [{ pages: () => [localPage, otherPage] }],
    close: async () => {}
  }
  const fakeFs = {
    realpathSync: (p) => p,
    statSync: () => ({ uid: 1000, mode: 0o40700 }),
    existsSync: () => true,
    readlinkSync: (p) => (p === '/proc/self/fd/9' ? 'net:[200]' : 'net:[100]'),
    readFileSync: (p) => {
      const files = {
        'local-browser-identity.json': { browserPageId: pageId, profileId: 'default' },
        'local-browser-ready.json': { port: 32123 },
        'browser-owner-before.json': before,
        'local-browser-closed.json': { ok: true, browserPageId: pageId },
        'status-closed-after-browser.json': { result: { app: { desktopWindowStatus: 'openable' } } }
      }
      assert.ok(Object.hasOwn(files, path.basename(p)), `unexpected fixture read ${p}`)
      return JSON.stringify(files[path.basename(p)])
    },
    openSync: () => 99,
    fstatSync: () => ({ size: log.length }),
    readSync: (_fd, buffer, offset, length, position) =>
      log.copy(buffer, offset, position, position + length),
    closeSync: () => {},
    writeFileSync: (p, data) => receipts.set(path.basename(p), JSON.parse(data))
  }
  const fakeProcess = {
    argv: ['node', 'attestation', stage, fixture],
    env: {
      ASH_TEST_PRIVATE_ROOT: '/tmp',
      ASH_USER_DATA_PATH: `${fixture}/profile`,
      ASH_TEST_EXPECTED_NETNS: 'net:[200]',
      ASH_TEST_APP_PID: '1234',
      ASH_TEST_PARENT_NETNS_FD: '9',
      ASH_TEST_APP_LOG_PATH: `${fixture}/app.log`
    },
    getuid: () => 1000,
    exitCode: 0
  }
  const modules = {
    'node:assert/strict': assert,
    'node:fs': fakeFs,
    'node:path': path,
    'node:timers/promises': {
      setTimeout: async () => {
        clock += 150
      }
    },
    'playwright-core': { chromium: { connectOverCDP: async () => browser } }
  }
  // Return the script's own async entrypoint so the test can inspect its exit
  // status and receipts after it finishes. All executable code is repository-local.
  const script = source.replace('void run().catch(', 'return run().catch(')
  assert.notEqual(script, source)
  const execute = new Function('require', 'process', 'console', 'Date', script)
  await execute(
    (name) => modules[name],
    fakeProcess,
    { log: () => {}, error: (...args) => errors.push(args.join(' ')) },
    { now: () => clock }
  )
  return {
    code: fakeProcess.exitCode,
    receipt: receipts.get(`browser-owner-${stage}.json`),
    errors
  }
}

describe('packaged renderer ownership attestation', () => {
  it('rejects a closed-stage census with a persistently inaccessible target', async () => {
    const result = await attest({ stage: 'closed', inaccessible: true })
    expect(result.code).toBe(1)
    expect(result.receipt).toBeUndefined()
    expect(result.errors.join(' ')).toMatch(/incomplete|inspect/i)
  })

  it.each(['closed', 'before', 'after'])(
    'rejects an incomplete actual %s census after a successful negative control',
    async (stage) => {
      const result = await attest({ stage, inaccessible: true, actualOnly: true })
      expect(result.code).toBe(1)
      expect(result.receipt).toBeUndefined()
      expect(result.errors.join(' ')).toContain('Incomplete renderer census')
    }
  )

  it('rejects a reopened owner reusing the original WebContents ID, even with a complete census', async () => {
    const result = await attest({ stage: 'after', ownerId: 2 })
    expect(result.code).toBe(1)
    expect(result.receipt).toBeUndefined()
    expect(result.errors.join(' ')).toMatch(/WebContents|owner ID/i)
  })

  it('accepts a complete closed census with a real local target and no renderer owner', async () => {
    const result = await attest({ stage: 'closed' })
    expect(result.code).toBe(0)
    expect(result.receipt).toMatchObject({ ok: true, rendererAttachedOwnerCount: 0 })
  })

  it('accepts a new renderer WebContents ID for the same logical page and profile', async () => {
    const result = await attest({ stage: 'after' })
    expect(result.code).toBe(0)
    expect(result.receipt).toMatchObject({ ok: true, webContentsId: 6, previousWebContentsId: 2 })
  })

  it('allows transient target churn only when a later complete census is obtained', async () => {
    const result = await attest({ stage: 'after', transient: true, actualOnly: true })
    expect(result.code).toBe(0)
    expect(result.receipt).toMatchObject({
      ok: true,
      webContentsId: 6,
      inspectedPages: 2,
      evaluationFailures: 0,
      missingPageControlInspectedPages: 2,
      missingPageControlEvaluationFailures: 0
    })
  })
})
