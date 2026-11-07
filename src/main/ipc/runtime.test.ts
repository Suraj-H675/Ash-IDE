import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, onMock, removeAllListenersMock, removeHandlerMock, fromWebContentsMock } =
  vi.hoisted(() => ({
    handleMock: vi.fn(),
    onMock: vi.fn(),
    removeAllListenersMock: vi.fn(),
    removeHandlerMock: vi.fn(),
    fromWebContentsMock: vi.fn()
  }))
const dispatcherState = vi.hoisted(() => ({
  methods: [] as readonly { name: string }[],
  dispatch: vi.fn(async () => ({ id: 'desktop-ipc', ok: true, result: null }))
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock
  },
  ipcMain: {
    handle: handleMock,
    on: onMock,
    removeAllListeners: removeAllListenersMock,
    removeHandler: removeHandlerMock
  }
}))
vi.mock('../runtime/rpc/dispatcher', () => ({
  RpcDispatcher: class {
    constructor(options: { methods?: readonly { name: string }[] }) {
      dispatcherState.methods = options.methods ?? []
    }
    dispatch = dispatcherState.dispatch
    dispatchStreamingObjects = vi.fn(async () => {})
  }
}))
import { registerRuntimeHandlers } from './runtime'

describe('registerRuntimeHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    onMock.mockReset()
    removeAllListenersMock.mockReset()
    removeHandlerMock.mockReset()
    fromWebContentsMock.mockReset()
    dispatcherState.methods = []
    dispatcherState.dispatch.mockClear()
  })

  // #36923: the window's wake shares the runtime's one VM wake path with its sleep's suspend.
  it("routes the window's recipe VM wake through the runtime", async () => {
    const record = { id: 'vm-1', status: 'running' }
    const runtime = { wakeWorkspaceVm: vi.fn().mockResolvedValue(record) }

    registerRuntimeHandlers(runtime as never)

    const registration = handleMock.mock.calls.find(
      ([channel]) => channel === 'ephemeralVm:resumeWorkspace'
    )
    await expect(registration![1]({}, { workspaceId: 'repo::/vm' })).resolves.toBe(record)
    expect(runtime.wakeWorkspaceVm).toHaveBeenCalledWith('repo::/vm')
  })

  it('rejects a graph publication queued by a superseded main frame', () => {
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn()
    }
    registerRuntimeHandlers(runtime as never)
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'runtime:syncWindowGraph'
    )![1]
    const sender = { mainFrame: { generation: 2 } }
    fromWebContentsMock.mockReturnValue({ id: 17 })

    expect(() =>
      handler({ sender, senderFrame: { generation: 1 } }, { tabs: [], leaves: [] })
    ).toThrow('Runtime graph sync must originate from the current main frame')
    expect(runtime.syncWindowGraph).not.toHaveBeenCalled()
  })

  it('dispatches desktop renderer RPC through the Ash-only method registry', async () => {
    registerRuntimeHandlers({} as never)
    const handler = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')![1]
    const frame = {}
    const sender = {
      id: 71,
      mainFrame: frame,
      on: vi.fn(),
      once: vi.fn()
    }

    await handler({ sender, senderFrame: frame }, { method: 'plugins.open' })

    const names = new Set(dispatcherState.methods.map(({ name }) => name))
    expect(names.has('runtime.stop')).toBe(true)
    expect(names.has('plugins.open')).toBe(false)
    expect(names.has('mobile.tasks.list')).toBe(false)
    expect(dispatcherState.dispatch).toHaveBeenCalledOnce()
  })
})
