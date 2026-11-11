import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { AutocompleteProvider } from '@earendil-works/pi-tui'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import symbolReference from './index'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'symbol-session-'))
  vi.stubEnv('PI_CODING_AGENT_DIR', root)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

function mount(mode = 'tui') {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>()
  const exec = vi.fn().mockResolvedValue({ code: 1, stderr: 'not available', stdout: '', killed: false })
  const pi = { on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => handlers.set(event, handler), exec } as unknown as ExtensionAPI
  let provider!: AutocompleteProvider
  const current: AutocompleteProvider = {
    getSuggestions: vi.fn().mockResolvedValue(null),
    applyCompletion: vi.fn(),
  }
  const notify = vi.fn()
  const addAutocompleteProvider = vi.fn((factory: (current: AutocompleteProvider) => AutocompleteProvider) => {
    provider = factory(current)
  })
  const ctx = { mode, cwd: root, isProjectTrusted: () => false, ui: { notify, addAutocompleteProvider } } as unknown as ExtensionContext
  symbolReference(pi)
  const start = () => handlers.get('session_start')!(undefined, ctx)
  const shutdown = () => handlers.get('session_shutdown')!(undefined, ctx)
  start()
  return {
    get provider() {
      return provider
    },
    exec,
    notify,
    addAutocompleteProvider,
    start,
    shutdown,
  }
}

it('接线真实配置、忽略不可信项目命令，每会话只提醒一次但允许重试', async () => {
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ symbolReference: { command: ['global-cli', '{query}'] } }))
  mkdirSync(join(root, '.pi'))
  writeFileSync(join(root, '.pi/settings.json'), JSON.stringify({ symbolReference: { command: ['untrusted-cli'] } }))
  const mounted = mount()
  const query = async () => {
    const pending = mounted.provider.getSuggestions(['#foo'], 0, 4, { signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(80)
    expect(await pending).toBeNull()
  }
  await query()
  await query()
  expect(mounted.exec).toHaveBeenCalledTimes(2)
  expect(mounted.exec.mock.calls[0]![0]).toBe('global-cli')
  expect(mounted.notify).toHaveBeenCalledOnce()
  mounted.shutdown()
  mounted.start()
  await query()
  expect(mounted.notify).toHaveBeenCalledTimes(2)
})

it('会话关闭会取消防抖和后续请求，清理可重复调用', async () => {
  const mounted = mount()
  const pending = mounted.provider.getSuggestions(['#foo'], 0, 4, { signal: new AbortController().signal })
  mounted.shutdown()
  mounted.shutdown()
  await vi.advanceTimersByTimeAsync(80)
  expect(await pending).toBeNull()
  expect(mounted.exec).not.toHaveBeenCalled()
})

it('非 TUI 模式不挂载补全也不执行 CLI', () => {
  const mounted = mount('rpc')
  expect(mounted.addAutocompleteProvider).not.toHaveBeenCalled()
  expect(mounted.exec).not.toHaveBeenCalled()
})
