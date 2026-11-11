import type { AutocompleteProvider } from '@earendil-works/pi-tui'
import { homedir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSymbolProvider, type SymbolProviderOptions } from './provider'

const config = {
  enabled: true,
  command: ['vv-mcp', 'lsp', '--uri', '{cwd}', '--query', '{query}', '--max-results', '{limit}'],
  debounceMs: 80,
  timeoutMs: 5000,
  maxResults: 50,
  insertTemplate: '#{name} {path}:{line}',
}
const output = {
  code: 0,
  killed: false,
  truncated: false,
  stderr: '',
  stdout: JSON.stringify({
    clients: ['tsrs'],
    symbols: {
      '/project/lib/debug.ts': [
        { name: 'createDebug', kind: 'Function', range: '12:17-12:28' },
      ],
    },
  }),
}

function mount(exec = vi.fn<SymbolProviderOptions['exec']>().mockResolvedValue(output), overrides: Partial<typeof config> = {}) {
  const current: AutocompleteProvider = {
    triggerCharacters: ['@', '$'],
    getSuggestions: vi.fn().mockResolvedValue(null),
    applyCompletion: vi.fn().mockReturnValue({ lines: ['delegated'], cursorLine: 0, cursorCol: 0 }),
    shouldTriggerFileCompletion: vi.fn().mockReturnValue(true),
  }
  const onError = vi.fn()
  const created = createSymbolProvider(current, { config: { ...config, ...overrides }, cwd: '/project', exec, onError })
  const suggest = (text: string, signal = new AbortController().signal) => created.provider.getSuggestions([text], 0, text.length, { signal })
  return { ...created, current, exec, onError, suggest }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('符号补全查询和插入', () => {
  it('连续输入只在最后一次停止 80ms 后启动命令，并保留内置触发符', async () => {
    const { suggest, exec, provider } = mount()
    const first = suggest('#cre')
    await vi.advanceTimersByTimeAsync(60)
    const second = suggest('看看 #create')
    await vi.advanceTimersByTimeAsync(79)
    expect(exec).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).toBeNull()
    const result = await second
    expect(exec).toHaveBeenCalledOnce()
    expect(exec).toHaveBeenCalledWith(
      'vv-mcp',
      ['lsp', '--uri', '/project', '--query', 'create', '--max-results', '50'],
      expect.objectContaining({ cwd: '/project', timeout: 5000, signal: expect.any(AbortSignal) }),
    )
    expect(provider.triggerCharacters).toEqual(['@', '$', '#'])
    expect(result?.items[0]).toEqual({ value: '#createDebug lib/debug.ts:12', label: 'createDebug', description: 'Function · lib/debug.ts:12' })
    expect(provider.applyCompletion(['前一行', '看看 #create 之后'], 1, 10, result!.items[0]!, '#create')).toEqual({
      lines: ['前一行', '看看 #createDebug lib/debug.ts:12  之后'],
      cursorLine: 1,
      cursorCol: 32,
    })
  })

  it('非符号 token 委托原 provider，裸 # 不发请求且不触发文件补全', async () => {
    const { suggest, current, exec, provider } = mount()
    for (const text of ['@lib', '$skill', '/help', 'abc#def', '##title', '@"some path #file']) await suggest(text)
    expect(current.getSuggestions).toHaveBeenCalledTimes(6)
    expect(await suggest('#')).toBeNull()
    expect(exec).not.toHaveBeenCalled()
    expect(provider.shouldTriggerFileCompletion?.(['#'], 0, 1)).toBe(false)
    expect(provider.shouldTriggerFileCompletion?.(['@lib'], 0, 4)).toBe(true)
    provider.applyCompletion(['@li'], 0, 3, { value: 'lib/', label: 'lib/' }, '@li')
    expect(current.applyCompletion).toHaveBeenCalledOnce()
  })

  it('请求取消、离开 token 或销毁时不会执行待防抖的命令', async () => {
    for (const reason of ['abort', 'leave', 'dispose']) {
      const { suggest, exec, dispose } = mount()
      const controller = new AbortController()
      const pending = suggest('#foo', controller.signal)
      if (reason === 'abort') controller.abort()
      if (reason === 'leave') await suggest('plain')
      if (reason === 'dispose') {
        dispose()
        dispose()
      }
      await vi.runAllTimersAsync()
      expect(await pending).toBeNull()
      expect(exec).not.toHaveBeenCalled()
    }
  })

  it('取消已经启动的命令，忽略不遵循取消信号的旧结果', async () => {
    let resolve!: (value: typeof output) => void
    const exec = vi.fn<SymbolProviderOptions['exec']>()
      .mockImplementationOnce(() =>
        new Promise((done) => {
          resolve = done
        })
      )
      .mockResolvedValue(output)
    const { suggest, onError } = mount(exec)
    const old = suggest('#old')
    await vi.advanceTimersByTimeAsync(80)
    const latest = suggest('#create')
    expect(exec.mock.calls[0]![2]!.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(80)
    expect((await latest)?.prefix).toBe('#create')
    // 不等待旧进程退出；真实 Editor 会先 await 旧请求才启动后续补全
    expect(await old).toBeNull()
    resolve(output)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    { ...output, code: 1, stderr: 'LSP unavailable' },
    { ...output, killed: true },
    { ...output, truncated: true },
    { ...output, stdout: 'not json' },
    { ...output, stdout: '{"error":"invalid query"}' },
  ])('失败不提供候选，错误通过回调可观察', async (result) => {
    const { suggest, onError } = mount(vi.fn<SymbolProviderOptions['exec']>().mockResolvedValue(result))
    const pending = suggest('#foo')
    await vi.advanceTimersByTimeAsync(80)
    expect(await pending).toBeNull()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('CLI 失败时显示 stdout JSON 中的具体错误，而不只显示退出码', async () => {
    const { suggest, onError } = mount(
      vi.fn<SymbolProviderOptions['exec']>().mockResolvedValue({
        ...output,
        code: 1,
        stdout: JSON.stringify({ error: { code: 'request_failed', message: 'Workspace LSP cold start timed out' } }),
      }),
    )
    const pending = suggest('#foo')
    await vi.advanceTimersByTimeAsync(80)
    expect(await pending).toBeNull()
    expect(onError).toHaveBeenCalledWith('Workspace LSP cold start timed out')
  })

  it('外部取消立即释放补全队列，迟到的进程异常不再提示', async () => {
    let reject!: (reason: Error) => void
    const { suggest, onError } = mount(
      vi.fn().mockImplementation(() =>
        new Promise((_, fail) => {
          reject = fail
        })
      ),
    )
    const controller = new AbortController()
    const pending = suggest('#foo', controller.signal)
    await vi.advanceTimersByTimeAsync(80)
    controller.abort()
    expect(await pending).toBeNull()
    reject(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).not.toHaveBeenCalled()
  })

  it('展开配置中命令和参数的主目录前缀，不展开查询或其他用户', async () => {
    const { suggest, exec } = mount(vi.fn<SymbolProviderOptions['exec']>().mockResolvedValue(output), {
      command: ['~/bin/symbol-cli', '~', '~/project/{query}', '{query}', '~someone/bin', 'prefix~/data'],
    })
    const pending = suggest('#~/needle')
    await vi.advanceTimersByTimeAsync(80)
    await pending
    expect(exec).toHaveBeenCalledWith(
      `${homedir()}/bin/symbol-cli`,
      [homedir(), `${homedir()}/project/~/needle`, '~/needle', '~someone/bin', 'prefix~/data'],
      expect.objectContaining({ cwd: '/project' }),
    )
  })

  it('展开两种环境变量语法，替换值保持原样且不经过 shell', async () => {
    vi.stubEnv('VV_SYMBOL_CLI_HOME', '/tmp/symbol tools')
    vi.stubEnv('VV_SYMBOL_CLI_ARG', 'literal $HOME {query}')
    vi.stubEnv('VV_SYMBOL_CLI_UNSET', undefined)
    vi.stubEnv('query', 'from-env')
    const { suggest, exec } = mount(vi.fn<SymbolProviderOptions['exec']>().mockResolvedValue(output), {
      command: [
        '${VV_SYMBOL_CLI_HOME}/bin/search',
        '$VV_SYMBOL_CLI_HOME',
        '${VV_SYMBOL_CLI_ARG}',
        '{query}',
        '${query}',
        '$VV_SYMBOL_CLI_UNSET',
        '${VV_SYMBOL_CLI_UNSET}',
        '$$VV_SYMBOL_CLI_HOME',
        '$(whoami)',
      ],
    })
    const pending = suggest('#$VV_SYMBOL_CLI_HOME')
    await vi.advanceTimersByTimeAsync(80)
    await pending
    expect(exec).toHaveBeenCalledWith(
      '/tmp/symbol tools/bin/search',
      [
        '/tmp/symbol tools',
        'literal $HOME {query}',
        '$VV_SYMBOL_CLI_HOME',
        'from-env',
        '$VV_SYMBOL_CLI_UNSET',
        '${VV_SYMBOL_CLI_UNSET}',
        '$VV_SYMBOL_CLI_HOME',
        '$(whoami)',
      ],
      expect.any(Object),
    )
  })

  it('参数不经过 shell，也不会递归替换查询中的占位符', async () => {
    const { suggest, exec } = mount()
    const pending = suggest('#$(bad);{cwd}')
    await vi.advanceTimersByTimeAsync(80)
    await pending
    expect(exec.mock.calls[0]![1]).toContain('$(bad);{cwd}')
  })
})
