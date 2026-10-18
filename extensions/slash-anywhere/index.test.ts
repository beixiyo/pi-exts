/**
 * 句中补全 provider 契约测试
 *
 * 捕获的失败面：token 边界判断只认「行内空白」时，换行后行首打 $ 无法触发
 * skill 补全（pi-tui 把行首视为 token 边界并主动发起补全请求，扩展却返回内置
 * provider 的空结果），以及消息开头打 $ 不弹层；补全产物「/命令 」让整行以 /
 * 开头后，其后继续打 $ 被行首 / 委托分支吞掉；以及该修复引入的边界：
 * 引号路径（@"a b $x）与子斜杠路径（~/Doc、$docs/）被句中通道劫持、
 * 配置 / 为触发符后行首命令名补全被劫持
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { AutocompleteProvider } from '@earendil-works/pi-tui'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import slashAnywhere from './index'

type SessionStartHandler = (
  event: unknown,
  ctx: { ui: { addAutocompleteProvider: (factory: (current: AutocompleteProvider) => AutocompleteProvider) => void } },
) => void

/** 挂载扩展，返回包装后的 provider 与内置 provider spy */
function mount(current: AutocompleteProvider, commands: { name: string; source: 'extension' | 'prompt' | 'skill' }[]) {
  const handlers: SessionStartHandler[] = []
  const pi = {
    on: vi.fn((_event: string, cb: SessionStartHandler) => {
      handlers.push(cb)
    }),
    getCommands: vi.fn(() =>
      commands.map((cmd, i) => ({
        name: cmd.name,
        source: cmd.source,
        sourceInfo: { path: `/cmd/${i}` },
      }))
    ),
  } as unknown as ExtensionAPI

  let factory!: (cur: AutocompleteProvider) => AutocompleteProvider
  slashAnywhere(pi)
  // 扩展会注册多个 session_start（provider + 缓存清理），全部触发
  for (const handler of handlers) {
    handler(undefined, {
      ui: {
        addAutocompleteProvider: (f) => {
          factory = f
        },
      },
    })
  }
  return factory(current)
}

describe('slash-anywhere getSuggestions', () => {
  let agentDir: string

  beforeEach(() => {
    // 空配置目录 → 触发符 $、自动通道仅 skill，避免读到真实 ~/.pi 配置
    agentDir = mkdtempSync(join(tmpdir(), 'slash-anywhere-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
  })

  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR
    rmSync(agentDir, { recursive: true, force: true })
  })

  function mountDefault() {
    const builtin = {
      triggerCharacters: ['@', '#'],
      getSuggestions: vi.fn().mockResolvedValue(null),
      applyCompletion: vi.fn().mockReturnValue({ lines: [''], cursorLine: 0, cursorCol: 0 }),
    }
    const provider = mount(builtin, [
      { name: 'debug-tool', source: 'extension' },
      { name: 'review-prompt', source: 'prompt' },
      { name: 'vue-skill', source: 'skill' },
    ])
    return { provider, builtin }
  }

  it('换行后的行首 $token 触发 skill 补全（回归：修复前落到内置 provider 无结果）', async () => {
    const { provider, builtin } = mountDefault()
    const lines = ['先看这个组件', '$vue']

    const result = await provider.getSuggestions(lines, 1, 4, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).not.toHaveBeenCalled()
    expect(result?.prefix).toBe('$vue')
    expect(result?.items.map((i) => i.value)).toEqual(['vue-skill'])
  })

  it('消息开头的 $token 也触发（与 pi-tui 行首 token 边界一致）', async () => {
    const { provider } = mountDefault()
    const result = await provider.getSuggestions(['$vue'], 0, 4, { signal: new AbortController().signal })

    expect(result?.prefix).toBe('$vue')
    expect(result?.items.map((i) => i.value)).toEqual(['vue-skill'])
  })

  it('$ 自动通道只补 skill，不含 extension / prompt 命令', async () => {
    const { provider } = mountDefault()
    const result = await provider.getSuggestions(['帮我 $'], 0, 4, { signal: new AbortController().signal })

    expect(result?.items.map((i) => i.value)).toEqual(['vue-skill'])
  })

  it('行中空白后的 $token 行为不变', async () => {
    const { provider } = mountDefault()
    const result = await provider.getSuggestions(['用 $vue 改一下'], 0, 6, { signal: new AbortController().signal })

    expect(result?.prefix).toBe('$vue')
    expect(result?.items.map((i) => i.value)).toEqual(['vue-skill'])
  })

  it('补全产物行（/命令 开头）后再打 $ 仍触发句中补全（回归：修复前行首 / 委托吞掉 $token）', async () => {
    const { provider, builtin } = mountDefault()

    const result = await provider.getSuggestions(['/vue-skill $vue'], 0, 15, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).not.toHaveBeenCalled()
    expect(result?.prefix).toBe('$vue')
    expect(result?.items.map((i) => i.value)).toEqual(['vue-skill'])
  })

  it('补全产物行上的 $token 选中后仅替换 token 本身', () => {
    const { provider } = mountDefault()

    const next = provider.applyCompletion(['/vue-skill $vue'], 0, 15, { value: 'vue-skill', label: 'vue-skill' }, '$vue')

    expect(next).toEqual({ lines: ['/vue-skill /vue-skill '], cursorLine: 0, cursorCol: 22 })
  })

  it('行首 /token 始终委托内置 provider（含换行后的行）', async () => {
    const { provider, builtin } = mountDefault()
    await provider.getSuggestions(['/vue', ''], 0, 4, { signal: new AbortController().signal })
    await provider.getSuggestions(['上文', '/vue'], 1, 4, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).toHaveBeenCalledTimes(2)
  })

  it('引号路径内的 $token 委还内置（@"... 跨空格引号路径，回归：句中通道劫持会破坏路径）', async () => {
    const { provider, builtin } = mountDefault()

    await provider.getSuggestions(['/model @"folder $vue'], 0, 20, { signal: new AbortController().signal })
    await provider.getSuggestions(['看 "folder $vue'], 0, 14, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).toHaveBeenCalledTimes(2)
  })

  it('正文孤引号不抑制 $ 补全（内置不认非边界的开引号，不应据此让路）', async () => {
    const { provider, builtin } = mountDefault()

    const a = await provider.getSuggestions(['abc"def $vue'], 0, 12, { signal: new AbortController().signal })
    const b = await provider.getSuggestions(['say \\"quoted $vue'], 0, 17, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).not.toHaveBeenCalled()
    expect(a?.prefix).toBe('$vue')
    expect(b?.prefix).toBe('$vue')
  })

  it('闭合引号后的 $token 仍走句中通道（避免引号判定过度触发）', async () => {
    const { provider, builtin } = mountDefault()

    const result = await provider.getSuggestions(['sed "old" $vue'], 0, 14, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).not.toHaveBeenCalled()
    expect(result?.prefix).toBe('$vue')
  })

  it('含子斜杠的触发符路径（~/Doc、$docs/）委还内置文件补全', async () => {
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ slashAnywhere: { autoTriggerChars: ['$', '~'] } }))
    const { provider, builtin } = mountDefault()

    await provider.getSuggestions(['/model ~/Doc'], 0, 12, { signal: new AbortController().signal })
    await provider.getSuggestions(['看 ~/Doc'], 0, 8, { signal: new AbortController().signal })
    await provider.getSuggestions(['/model $docs/re'], 0, 15, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).toHaveBeenCalledTimes(3)
  })

  it('配置 / 为触发符被忽略，行首命令名补全仍委内内置（回归：手动通道语义被劫持）', async () => {
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ slashAnywhere: { autoTriggerChars: ['/', '$'] } }))
    const { provider, builtin } = mountDefault()

    await provider.getSuggestions(['/mode'], 0, 5, { signal: new AbortController().signal })
    await provider.getSuggestions(['/model gl'], 0, 9, { signal: new AbortController().signal })

    expect(builtin.getSuggestions).toHaveBeenCalledTimes(2)
  })

  it('换行后行首选中 $token 替换为 /命令 且不影响其他行', () => {
    const { provider } = mountDefault()
    const lines = ['第一行', '$vue', '第三行']

    const next = provider.applyCompletion(lines, 1, 4, { value: 'vue-skill', label: 'vue-skill' }, '$vue')

    expect(next).toEqual({ lines: ['第一行', '/vue-skill ', '第三行'], cursorLine: 1, cursorCol: 11 })
  })
})
