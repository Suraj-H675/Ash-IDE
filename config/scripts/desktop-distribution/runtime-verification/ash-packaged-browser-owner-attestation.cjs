// Test-only, read-only attestation that a retained logical browser page is
// represented by its real renderer-owned Electron <webview> after reopen.
// The DevTools endpoint is enabled only by the private native fixture runner
// and is unreachable outside that runner's private network namespace.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('playwright-core')

const [stage, root] = process.argv.slice(2)
if (!['before', 'closed', 'after'].includes(stage)) {
  throw new Error('Expected before, closed, or after')
}

const fixture = path.resolve(root ?? '')
const privateRoot = fs.realpathSync(process.env.ASH_TEST_PRIVATE_ROOT ?? '/var/tmp')
const fixtureTarget = fs.realpathSync(fixture)
const fixtureName = path.basename(fixtureTarget)
if (
  path.dirname(fixtureTarget) !== privateRoot ||
  !/^ash(?:x11|wl)\.[a-zA-Z0-9]{6}$/.test(fixtureName) ||
  !/^\/(?:tmp|var\/tmp)\/ash(?:x11|wl)\.[a-zA-Z0-9]{6}$/.test(fixture)
) {
  throw new Error('Refusing browser owner observation outside a private owned fixture')
}
const ownedFixture = fs.statSync(fixtureTarget)
if (
  ownedFixture.uid !== process.getuid() ||
  (ownedFixture.mode & 0o777) !== 0o700 ||
  !fs.existsSync(path.join(fixtureTarget, '.ash-desktop-lifecycle-fixture')) ||
  process.env.ASH_USER_DATA_PATH !== path.join(fixture, 'profile')
) {
  throw new Error('Refusing browser owner observation without a verified private Ash profile')
}

const currentNetns = fs.readlinkSync('/proc/self/ns/net')
const expectedNetns = process.env.ASH_TEST_EXPECTED_NETNS
const appPid = Number(process.env.ASH_TEST_APP_PID)
const parentNetnsFd = Number(process.env.ASH_TEST_PARENT_NETNS_FD)
assert.match(expectedNetns ?? '', /^net:\[[0-9]+\]$/)
assert.equal(parentNetnsFd, 9)
assert.equal(fs.readlinkSync(`/proc/self/fd/${parentNetnsFd}`), expectedNetns)
assert.notEqual(currentNetns, expectedNetns, 'DevTools must run inside a private network namespace')
assert.ok(Number.isInteger(appPid) && appPid > 1)
assert.equal(fs.readlinkSync(`/proc/${appPid}/ns/net`), currentNetns)
assert.equal(process.env.ASH_TEST_APP_LOG_PATH, path.join(fixture, 'app.log'))

const identity = JSON.parse(
  fs.readFileSync(path.join(fixture, 'local-browser-identity.json'), 'utf8')
)
assert.match(identity.browserPageId, /^[\w-]{4,}$/)
assert.equal(typeof identity.profileId, 'string')
const evidencePath = path.join(fixture, `browser-owner-${stage}.json`)

async function inspectRendererTargets(browser, browserPageId, fixtureOrigin) {
  const observation = {
    owners: [],
    inspectablePages: 0,
    fixturePageTargets: 0,
    evaluationFailures: 0
  }
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try {
        const result = await page.evaluate((pageId) => {
          const viewport = document.querySelector(`[data-browser-page-viewport-id="${pageId}"]`)
          const webview = viewport?.querySelector('webview') ?? null
          return {
            href: window.location.href,
            owner: viewport
              ? {
                  viewportConnected: viewport.isConnected,
                  webviewPresent: webview !== null,
                  webviewConnected: webview?.isConnected === true,
                  webviewTag: webview?.tagName ?? null,
                  webContentsId:
                    webview && typeof webview.getWebContentsId === 'function'
                      ? webview.getWebContentsId()
                      : null,
                  partition: webview?.getAttribute('partition') ?? null
                }
              : null
          }
        }, browserPageId)
        observation.inspectablePages += 1
        if (result.href === fixtureOrigin || result.href.startsWith(`${fixtureOrigin}/`)) {
          observation.fixturePageTargets += 1
        }
        if (result.owner) {
          observation.owners.push(result.owner)
        }
      } catch {
        observation.evaluationFailures += 1
        // A target can disappear while the host window is closing. It cannot
        // contribute positive ownership evidence unless its DOM query succeeds.
      }
    }
  }
  return observation
}

function completeCensus(observation) {
  return observation.evaluationFailures === 0 && observation.inspectablePages > 0
}

async function inspectMissingPageControl(browser, fixtureOrigin) {
  const deadline = Date.now() + 1_000
  let observation
  do {
    observation = await inspectRendererTargets(
      browser,
      'ash-owner-probe-negative-absent-page',
      fixtureOrigin
    )
    assert.deepEqual(observation.owners, [], 'missing page control must not produce an owner')
    if (completeCensus(observation)) {
      return observation
    }
    await delay(150)
  } while (Date.now() < deadline)
  throw new Error('Incomplete renderer census for missing page control')
}

async function connectToPrivateDevTools() {
  const logPath = process.env.ASH_TEST_APP_LOG_PATH
  const deadline = Date.now() + 15_000
  let websocketUrl
  let logOffset = 0
  let logHead = ''
  let logTail = ''
  do {
    const fd = fs.openSync(logPath, 'r')
    try {
      const fileSize = fs.fstatSync(fd).size
      if (fileSize < logOffset) {
        logOffset = 0
        logHead = ''
        logTail = ''
      }
      const chunk = Buffer.alloc(64 * 1024)
      while (logOffset < fileSize) {
        const length = Math.min(chunk.length, fileSize - logOffset)
        const bytesRead = fs.readSync(fd, chunk, 0, length, logOffset)
        if (bytesRead === 0) {
          break
        }
        const text = chunk.toString('utf8', 0, bytesRead)
        if (logOffset < 64 * 1024) {
          logHead += text.slice(0, 64 * 1024 - logOffset)
        }
        logTail = `${logTail}${text}`.slice(-128 * 1024)
        logOffset += bytesRead
      }
    } finally {
      fs.closeSync(fd)
    }
    const appLog = `${logHead}\n${logTail}`
    const match = appLog.match(
      /DevTools listening on (ws:\/\/127\.0\.0\.1:[0-9]+\/devtools\/browser\/[A-Za-z0-9_-]+)/
    )
    if (match) {
      websocketUrl = match[1]
    }
    if (websocketUrl) {
      break
    }
    await delay(150)
  } while (Date.now() < deadline)
  assert.ok(websocketUrl, 'private Chromium DevTools endpoint did not start')
  assert.match(websocketUrl, /^ws:\/\/127\.0\.0\.1:[0-9]+\//)
  return chromium.connectOverCDP(websocketUrl, { timeout: 10_000 })
}

async function run() {
  const browser = await connectToPrivateDevTools()
  try {
    const ready = JSON.parse(
      fs.readFileSync(path.join(fixture, 'local-browser-ready.json'), 'utf8')
    )
    assert.ok(Number.isInteger(ready.port) && ready.port > 0 && ready.port <= 65535)
    const fixtureOrigin = `http://127.0.0.1:${ready.port}`
    const missingPageControl = await inspectMissingPageControl(browser, fixtureOrigin)

    const deadline = Date.now() + (stage === 'closed' ? 1_000 : 15_000)
    let observation = {
      owners: [],
      inspectablePages: 0,
      fixturePageTargets: 0,
      evaluationFailures: 0
    }
    do {
      observation = await inspectRendererTargets(browser, identity.browserPageId, fixtureOrigin)
      if (stage === 'closed') {
        // A positive owner observation is disqualifying even if another page
        // failed inspection. Keep observing absence through the closed window.
        assert.deepEqual(
          observation.owners,
          [],
          'a hidden browser owner must not be mistaken for a renderer-attached webview'
        )
      } else if (completeCensus(observation) && observation.owners.length > 0) {
        break
      }
      await delay(150)
    } while (Date.now() < deadline)

    assert.ok(
      completeCensus(observation),
      'Incomplete renderer census: all page targets must be inspected'
    )
    const census = {
      inspectedPages: observation.inspectablePages,
      evaluationFailures: observation.evaluationFailures,
      missingPageControlInspectedPages: missingPageControl.inspectablePages,
      missingPageControlEvaluationFailures: missingPageControl.evaluationFailures
    }

    if (stage === 'closed') {
      assert.deepEqual(
        observation.owners,
        [],
        'a hidden browser owner must not be mistaken for a renderer-attached webview'
      )
      const closedBrowser = JSON.parse(
        fs.readFileSync(path.join(fixture, 'local-browser-closed.json'), 'utf8')
      )
      const closedStatus = JSON.parse(
        fs.readFileSync(path.join(fixture, 'status-closed-after-browser.json'), 'utf8')
      )
      assert.equal(
        closedBrowser.ok,
        true,
        'logical page still responds through the closed-window path'
      )
      assert.equal(closedBrowser.browserPageId, identity.browserPageId)
      assert.equal(closedStatus.result?.app?.desktopWindowStatus, 'openable')
      assert.ok(
        observation.inspectablePages > 0,
        'closed control must inspect actual CDP page targets'
      )
      assert.ok(
        observation.fixturePageTargets > 0,
        'closed control must see its hidden local page target'
      )
      fs.writeFileSync(
        evidencePath,
        `${JSON.stringify({
          ok: true,
          stage,
          browserPageId: identity.browserPageId,
          profileId: identity.profileId,
          rendererAttachedOwnerCount: 0,
          ...census,
          fixturePageTargets: observation.fixturePageTargets,
          hiddenOwnerNotAccepted: true,
          missingPageControlRejected: true,
          privateNetworkNamespace: currentNetns
        })}\n`,
        { mode: 0o600 }
      )
      console.log(
        JSON.stringify({
          ok: true,
          stage,
          browserPageId: identity.browserPageId,
          rendererAttachedOwnerCount: 0,
          ...census,
          fixturePageTargets: observation.fixturePageTargets,
          hiddenOwnerNotAccepted: true,
          missingPageControlRejected: true
        })
      )
      return
    }

    assert.equal(
      observation.owners.length,
      1,
      'the logical page must have exactly one renderer owner'
    )
    const owner = observation.owners[0]
    assert.equal(owner.viewportConnected, true)
    assert.equal(owner.webviewPresent, true)
    assert.equal(owner.webviewConnected, true)
    assert.equal(owner.webviewTag, 'WEBVIEW')
    assert.ok(Number.isInteger(owner.webContentsId) && owner.webContentsId > 0)
    assert.match(owner.partition ?? '', /^persist:/)

    if (stage === 'before') {
      fs.writeFileSync(
        evidencePath,
        `${JSON.stringify({
          ok: true,
          stage,
          browserPageId: identity.browserPageId,
          profileId: identity.profileId,
          partition: owner.partition,
          webContentsId: owner.webContentsId,
          rendererAttachedWebview: true,
          ...census,
          missingPageControlRejected: true,
          privateNetworkNamespace: currentNetns
        })}\n`,
        { mode: 0o600 }
      )
    } else {
      const before = JSON.parse(
        fs.readFileSync(path.join(fixture, 'browser-owner-before.json'), 'utf8')
      )
      assert.equal(before.browserPageId, identity.browserPageId)
      assert.equal(before.profileId, identity.profileId)
      assert.equal(owner.partition, before.partition, 'browser profile partition changed')
      assert.ok(Number.isInteger(before.webContentsId) && before.webContentsId > 0)
      assert.notEqual(
        owner.webContentsId,
        before.webContentsId,
        'reopened WebContents ID must differ from the previous owner'
      )
      fs.writeFileSync(
        evidencePath,
        `${JSON.stringify({
          ok: true,
          stage,
          browserPageId: identity.browserPageId,
          profileId: identity.profileId,
          partition: owner.partition,
          webContentsId: owner.webContentsId,
          previousWebContentsId: before.webContentsId,
          rendererAttachedWebview: true,
          sameLogicalPageAndProfile: true,
          ...census,
          missingPageControlRejected: true,
          privateNetworkNamespace: currentNetns
        })}\n`,
        { mode: 0o600 }
      )
    }
    console.log(
      JSON.stringify({
        ok: true,
        stage,
        browserPageId: identity.browserPageId,
        profileId: identity.profileId,
        partition: owner.partition,
        webContentsId: owner.webContentsId,
        rendererAttachedWebview: true,
        ...census,
        missingPageControlRejected: true
      })
    )
  } finally {
    await browser.close()
  }
}

void run().catch((error) => {
  console.error('Browser owner attestation failed:', error.message)
  process.exitCode = 1
})
