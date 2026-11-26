// A self-contained, account-free browser journey for a disposable packaged Ash
// runtime. Never serves a public interface, navigates an external URL or logs
// private browser data. The test-created page has no network dependencies.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const [mode, root, clientModule] = process.argv.slice(2)
const fixture = path.resolve(root ?? '')
const privateRoot = fs.realpathSync(process.env.ASH_TEST_PRIVATE_ROOT ?? '/var/tmp')
const fixtureTarget = fs.realpathSync(fixture)
const fixtureName = path.basename(fixtureTarget)
if (
  path.dirname(fixtureTarget) !== privateRoot ||
  !/^ash(?:x11|wl)\.[a-zA-Z0-9]{6}$/.test(fixtureName) ||
  !/^\/(?:tmp|var\/tmp)\/ash(?:x11|wl)\.[a-zA-Z0-9]{6}$/.test(fixture)
) {
  throw new Error('Refusing browser test outside a private owned fixture')
}
const ownedFixture = fs.statSync(fixtureTarget)
if (
  ownedFixture.uid !== process.getuid() ||
  (ownedFixture.mode & 0o777) !== 0o700 ||
  !fs.existsSync(path.join(fixtureTarget, '.ash-desktop-lifecycle-fixture')) ||
  process.env.ASH_USER_DATA_PATH !== path.join(fixture, 'profile')
) {
  throw new Error('Refusing browser test without a verified private Ash profile')
}
const fixtureInfo = path.join(fixture, 'local-browser-ready.json')
const firstPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ash Private Browser Journey</title></head><body>
<h1>Isolated Ash Browser</h1>
<button id="activate" onclick="document.getElementById('response').textContent='Activated local browser control'">Activate local browser</button>
<output id="response">Not activated</output>
<a id="next" href="/next">Local second page</a></body></html>`
const closedPage =
  '<!doctype html><title>Ash Closed Stage</title><h1>Closed-window navigation persisted</h1>'
const secondPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ash Local Navigation Passed</title></head><body><h1>Second local page</h1></body></html>`

if (mode === 'serve') {
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || !['/', '/next', '/closed'].includes(request.url)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    const body =
      request.url === '/' ? firstPage : request.url === '/closed' ? closedPage : secondPage
    response
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      })
      .end(body)
  })
  server.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    fs.writeFileSync(fixtureInfo, `${JSON.stringify({ port: address.port })}\n`, { mode: 0o600 })
    console.log('Local-only browser fixture is ready')
  })
  process.on('SIGTERM', () => server.close())
} else if (mode === 'before' || mode === 'closed' || mode === 'after') {
  void runJourney().catch((error) => {
    // Only test-only error names; never include responses with user state.
    console.error('Packaged browser smoke failed:', error.message)
    process.exitCode = 1
  })
} else {
  throw new Error('Expected serve, before, closed, or after')
}

async function runJourney() {
  const { RuntimeClient } = require(clientModule)
  const client = new RuntimeClient(process.env.ASH_USER_DATA_PATH)
  const port = JSON.parse(fs.readFileSync(fixtureInfo, 'utf8')).port
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
  const url = `http://127.0.0.1:${port}`
  const project = path.join(fixture, 'project')
  const profileIdentity = crypto
    .createHash('sha256')
    .update(fs.realpathSync(process.env.ASH_USER_DATA_PATH))
    .digest('hex')

  async function call(name, params) {
    const response = await client.call(name, params, { timeoutMs: 60_000 })
    if (response.ok !== true || !response.result) {
      throw new Error(`${name} failed with ${response.error?.code ?? 'unknown error'}`)
    }
    return response.result
  }

  async function assertStorage(page, token) {
    const stored = await call('browser.eval', {
      page,
      expression: `localStorage.getItem('ash-private-qa') + '|' + document.cookie`
    })
    assert.ok(stored.result.includes(`${token}|`), 'test-origin localStorage was not retained')
    assert.ok(
      stored.result.includes(`ash_private_qa=${token}`),
      'test-origin cookie was not retained'
    )
  }

  if (mode === 'before') {
    const created = await call('browser.tabCreate', {
      url: `${url}/`,
      worktree: project,
      waitForRegistration: true,
      activate: process.env.ASH_TEST_BROWSER_OWNER_PROBE === '1'
    })
    assert.match(created.browserPageId, /^[\w-]{4,}$/)
    fs.writeFileSync(
      path.join(fixture, 'local-browser-tab.json'),
      `${JSON.stringify({ browserPageId: created.browserPageId })}\n`,
      { mode: 0o600 }
    )
    const snapshot = await call('browser.snapshot', { page: created.browserPageId })
    assert.equal(snapshot.url, `${url}/`)
    assert.match(JSON.stringify(snapshot.snapshot), /Isolated Ash Browser/)
    const listed = await call('browser.tabList', { worktree: project })
    const identity = listed.tabs.find((tab) => tab.browserPageId === created.browserPageId)
    assert.ok(identity, 'The new browser page must be listed in the selected worktree')
    assert.equal(typeof identity.profileId, 'string')
    await call('browser.click', {
      page: created.browserPageId,
      element: '#activate',
      expectUrl: `${url}/`
    })
    const evaluated = await call('browser.eval', {
      page: created.browserPageId,
      expression: "document.title + '|' + document.getElementById('response').textContent"
    })
    assert.match(evaluated.result, /Ash Private Browser Journey\|Activated local browser control/)
    const storageToken = crypto.randomBytes(16).toString('hex')
    await call('browser.eval', {
      page: created.browserPageId,
      expression: `localStorage.setItem('ash-private-qa', '${storageToken}'); document.cookie = 'ash_private_qa=${storageToken}; Path=/; Max-Age=3600; SameSite=Strict'`
    })
    const navigated = await call('browser.goto', {
      page: created.browserPageId,
      url: `${url}/next`
    })
    assert.equal(navigated.url, `${url}/next`)
    const after = await call('browser.snapshot', { page: created.browserPageId })
    assert.match(JSON.stringify(after.snapshot), /Second local page/)
    await assertStorage(created.browserPageId, storageToken)
    fs.writeFileSync(
      path.join(fixture, 'local-browser-identity.json'),
      `${JSON.stringify({
        browserPageId: created.browserPageId,
        profileId: identity.profileId,
        profileLabel: identity.profileLabel,
        storageToken,
        profileIdentity
      })}\n`,
      { mode: 0o600 }
    )
    console.log(
      JSON.stringify({
        ok: true,
        browserPageId: created.browserPageId,
        profileId: identity.profileId,
        profileIdentity,
        firstPage: true,
        click: true,
        evaluation: true,
        secondPage: true,
        storageRetained: true,
        testUrlLoopbackOnly: true
      })
    )
  } else {
    const identity = JSON.parse(
      fs.readFileSync(path.join(fixture, 'local-browser-identity.json'), 'utf8')
    )
    const { browserPageId, profileId, storageToken } = identity
    assert.match(storageToken, /^[a-f0-9]{32}$/)
    assert.equal(identity.profileIdentity, profileIdentity, 'Browser profile path changed')
    if (mode === 'closed') {
      await call('browser.goto', { page: browserPageId, url: `${url}/` })
      await assertStorage(browserPageId, storageToken)
      await call('browser.click', {
        page: browserPageId,
        element: '#activate',
        expectUrl: `${url}/`
      })
      const evaluated = await call('browser.eval', {
        page: browserPageId,
        expression: "document.title + '|' + document.getElementById('response').textContent"
      })
      assert.match(evaluated.result, /Ash Private Browser Journey\|Activated local browser control/)
      const navigated = await call('browser.goto', {
        page: browserPageId,
        url: `${url}/closed`
      })
      assert.equal(navigated.url, `${url}/closed`)
      const after = await call('browser.snapshot', { page: browserPageId })
      assert.equal(after.url, `${url}/closed`)
      assert.match(JSON.stringify(after.snapshot), /Closed-window navigation persisted/)
      const listed = await call('browser.tabList', { worktree: project })
      const retained = listed.tabs.find((tab) => tab.browserPageId === browserPageId)
      assert.equal(retained?.profileId, profileId)
      const extra = await call('browser.tabCreate', {
        url: `${url}/next`,
        worktree: project,
        activate: false,
        profileId
      })
      assert.notEqual(extra.browserPageId, browserPageId)
      await call('browser.snapshot', { page: extra.browserPageId })
      fs.writeFileSync(
        path.join(fixture, 'local-browser-close-on-reopen.json'),
        JSON.stringify({ page: extra.browserPageId }),
        { mode: 0o600 }
      )
      console.log(
        JSON.stringify({
          ok: true,
          browserPageId,
          profileId,
          profileIdentity,
          closedStage: true,
          storageRetained: true,
          click: true,
          evaluation: evaluated.result,
          navigation: navigated.url,
          loopbackOnly: true
        })
      )
      return
    }
    // Desktop readiness does not imply the reopened Chromium tab has finished
    // restoring its navigation URL and document. Keep the *same* page ID and
    // full rendered-content assertions, but allow that asynchronous restore a
    // short, bounded window instead of sampling the initial blank URL once.
    const extra = JSON.parse(
      fs.readFileSync(path.join(fixture, 'local-browser-close-on-reopen.json'), 'utf8')
    )
    assert.notEqual(extra.page, browserPageId)
    const closed = await call('browser.tabClose', { page: extra.page, worktree: project })
    assert.equal(closed.closed, true)
    const postClose = await call('browser.tabList', { worktree: project })
    assert.ok(
      !postClose.tabs.some((tab) => tab.browserPageId === extra.page),
      'Offscreen-only page remained listed after close'
    )
    const expectedUrl = `${url}/closed`
    const restoreDeadline = Date.now() + 12_000
    let retained
    let reopened
    do {
      const tabs = await call('browser.tabList', { worktree: project })
      retained = tabs.tabs.find((tab) => tab.browserPageId === browserPageId)
      if (retained?.url && retained.url !== expectedUrl) {
        assert.equal(retained.url, expectedUrl, 'reopened tab navigated away from its original URL')
      }
      if (retained?.url === expectedUrl) {
        reopened = await call('browser.snapshot', { page: browserPageId })
        if (reopened.url && reopened.url !== expectedUrl) {
          assert.equal(
            reopened.url,
            expectedUrl,
            'reopened page navigated away from its original URL'
          )
        }
        if (
          reopened.url === expectedUrl &&
          /Closed-window navigation persisted/.test(JSON.stringify(reopened.snapshot))
        ) {
          break
        }
      }
      await delay(300)
    } while (Date.now() < restoreDeadline)
    assert.ok(retained, 'Browser tab was not retained across GUI close/reopen')
    assert.equal(retained.url, expectedUrl)
    assert.ok(reopened, 'Browser page did not finish reopening')
    assert.equal(reopened.url, expectedUrl)
    assert.match(JSON.stringify(reopened.snapshot), /Closed-window navigation persisted/)
    const listed = await call('browser.tabList', { worktree: project })
    const profileRetained = listed.tabs.find((tab) => tab.browserPageId === browserPageId)
    assert.equal(profileRetained?.profileId, profileId)
    await assertStorage(browserPageId, storageToken)
    console.log(
      JSON.stringify({
        ok: true,
        sameBrowserPageId: true,
        sameProfileId: true,
        profileIdentity,
        retainedUrl: true,
        loadedAfterReopen: true,
        extraOffscreenPageClosed: true,
        storageRetained: true,
        testUrlLoopbackOnly: true
      })
    )
  }
}
