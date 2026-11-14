// A self-contained, account-free browser journey for a disposable packaged Ash
// runtime. Never serves a public interface, navigates an external URL or logs
// private browser data. The test-created page has no network dependencies.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const [mode, root, clientModule] = process.argv.slice(2)
if (!/^\/var\/tmp\/ashx11\.[a-zA-Z0-9]{6}$/.test(root ?? '')) {
  throw new Error('Refusing browser test outside a private X11 fixture')
}
const fixture = path.resolve(root)
const ownedFixture = fs.statSync(fixture)
if (
  ownedFixture.uid !== process.getuid() ||
  (ownedFixture.mode & 0o777) !== 0o700 ||
  !fs.existsSync(path.join(fixture, '.ash-desktop-lifecycle-fixture')) ||
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
const secondPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ash Local Navigation Passed</title></head><body><h1>Second local page</h1></body></html>`

if (mode === 'serve') {
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || (request.url !== '/' && request.url !== '/next')) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    const body = request.url === '/' ? firstPage : secondPage
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
} else if (mode === 'before' || mode === 'after') {
  void runJourney().catch((error) => {
    // Only test-only error names; never include responses with user state.
    console.error('Packaged browser smoke failed:', error.message)
    process.exitCode = 1
  })
} else {
  throw new Error('Expected serve, before, or after')
}

async function runJourney() {
  const { RuntimeClient } = require(clientModule)
  const client = new RuntimeClient(process.env.ASH_USER_DATA_PATH)
  const port = JSON.parse(fs.readFileSync(fixtureInfo, 'utf8')).port
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
  const url = `http://127.0.0.1:${port}`
  const project = path.join(fixture, 'project')

  async function call(name, params) {
    const response = await client.call(name, params, { timeoutMs: 60_000 })
    if (response.ok !== true || !response.result) {
      throw new Error(`${name} failed with ${response.error?.code ?? 'unknown error'}`)
    }
    return response.result
  }

  if (mode === 'before') {
    const created = await call('browser.tabCreate', {
      url: `${url}/`,
      worktree: project,
      waitForRegistration: true,
      activate: true
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
    const navigated = await call('browser.goto', {
      page: created.browserPageId,
      url: `${url}/next`
    })
    assert.equal(navigated.url, `${url}/next`)
    const after = await call('browser.snapshot', { page: created.browserPageId })
    assert.match(JSON.stringify(after.snapshot), /Second local page/)
    console.log(
      JSON.stringify({
        ok: true,
        browserPageId: created.browserPageId,
        firstPage: true,
        click: true,
        evaluation: true,
        secondPage: true,
        testUrlLoopbackOnly: true
      })
    )
  } else {
    const { browserPageId } = JSON.parse(
      fs.readFileSync(path.join(fixture, 'local-browser-tab.json'), 'utf8')
    )
    const tabs = await call('browser.tabList', { worktree: project })
    const retained = tabs.tabs.find((tab) => tab.browserPageId === browserPageId)
    assert.ok(retained, 'Browser tab was not retained across GUI close/reopen')
    assert.equal(retained.url, `${url}/next`)
    const reopened = await call('browser.snapshot', { page: browserPageId })
    assert.equal(reopened.url, `${url}/next`)
    assert.match(JSON.stringify(reopened.snapshot), /Second local page/)
    console.log(
      JSON.stringify({
        ok: true,
        sameBrowserPageId: true,
        retainedUrl: true,
        loadedAfterReopen: true,
        testUrlLoopbackOnly: true
      })
    )
  }
}
