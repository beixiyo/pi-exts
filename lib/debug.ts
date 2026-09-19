/**
 * 调试日志（扩展共享）
 *
 * 环境变量开关 + ISO 时间戳追加写文件；默认关闭零开销
 */
import { appendFileSync } from 'node:fs'

/** 按环境变量与文件路径构造调试日志函数 */
export function createDebug(envKey: string, file: string): (...args: unknown[]) => void {
  return (...args) => {
    if (!process.env[envKey]) return
    try {
      appendFileSync(file, `${new Date().toISOString()} ${args.join(' ')}\n`)
    }
    catch {}
  }
}
