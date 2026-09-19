/**
 * pi settings 读取（扩展共享）
 *
 * 合并 global（~/.pi/agent/settings.json）与 project（<cwd>/.pi/settings.json），
 * 顶层键浅合并（project 覆盖 global），与 pi-mcp-adapter 的合并语义一致；
 * 文件缺失或 JSON 非法时静默跳过，绝不抛错
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** pi agent 目录（尊重 PI_CODING_AGENT_DIR 环境变量） */
export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

function readJson(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
}

/**
 * 读取合并后的 pi settings（project 顶层键覆盖 global）
 * 每次调用都重新读盘：改 settings.json 后 /reload 或下会话即生效
 */
export function readSettings(): Record<string, unknown> {
  return {
    ...readJson(join(getAgentDir(), 'settings.json')),
    ...readJson(join(process.cwd(), '.pi', 'settings.json')),
  }
}

/**
 * 读取单个扩展命名空间配置对象
 *
 * @param key settings.json 下的顶层键名（如 'autoRename'、'statusline'）
 * @returns 配置对象；键缺失或值不是对象时返回 undefined
 */
export function readExtensionConfig(key: string): Record<string, unknown> | undefined {
  const value = readSettings()[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
