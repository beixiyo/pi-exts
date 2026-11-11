import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from './config'

let root: string
let agent: string
let cwd: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'symbol-config-'))
  agent = join(root, 'agent')
  cwd = join(root, 'project')
  mkdirSync(agent)
  mkdirSync(join(cwd, '.pi'), { recursive: true })
  vi.stubEnv('PI_CODING_AGENT_DIR', agent)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

function settings(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify({ symbolReference: value }))
}

describe('符号补全 JSON 配置', () => {
  it('默认调用 vv-mcp，防抖 80ms', () => {
    expect(loadConfig({ cwd })).toMatchObject({ debounceMs: 80, insertTemplate: '#{name} {path}:{line}' })
    expect(loadConfig({ cwd }).command[0]).toBe('vv-mcp')
  })

  it('可信项目覆盖全局命令，不可信项目只能使用全局配置', () => {
    settings(join(agent, 'settings.json'), { command: ['global-tool', '{query}'], debounceMs: 90 })
    settings(join(cwd, '.pi', 'settings.json'), { command: ['project-tool', '{query}'], maxResults: 10 })
    expect(loadConfig({ cwd, projectTrusted: false })).toMatchObject({ command: ['global-tool', '{query}'], debounceMs: 90 })
    expect(loadConfig({ cwd, projectTrusted: true })).toMatchObject({ command: ['project-tool', '{query}'], debounceMs: 80, maxResults: 10 })
  })

  it.each([
    { command: [] },
    { command: 'tool --query' },
    { command: [''] },
    { command: ['tool', 1] },
    { debounceMs: -1 },
    { timeoutMs: 0 },
    { maxResults: 1.5 },
    { insertTemplate: '' },
  ])('非法配置明确报错，不悄悄启动默认工具', (value) => {
    settings(join(agent, 'settings.json'), value)
    expect(() => loadConfig({ cwd })).toThrow('symbolReference.')
  })
})
