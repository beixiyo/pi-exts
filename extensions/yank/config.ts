/**
 * /yank 配置读取与归一化
 *
 * ## 配置（~/.pi/agent/settings.json 的 yank 键，整段可省略，省省即用默认值）
 *   {
 *     "yank": {
 *       "maxTurns": 20,        // 最多展示的消息轮数（各角色独立计数）
 *       "maxUnits": 300,       // 列表项总数上限
 *       "previewWidth": 48,    // label 首行摘要的显示宽度（列）
 *       "maxVisible": 12,      // 选择器一次可见行数
 *       "defaultMode": "answers"   // answers | codes | questions
 *     }
 *   }
 */
import { readExtensionConfig } from '../../lib/settings'

/** 列表模式：回答（可展开代码块）/ 代码块 / 用户问题 */
export type YankMode = 'answers' | 'codes' | 'questions'

/** Tab 循环顺序与显示名 */
export const MODES: readonly { key: YankMode; label: string }[] = [
  { key: 'answers', label: 'answers' },
  { key: 'codes', label: 'codes' },
  { key: 'questions', label: 'questions' },
]

export interface YankConfig {
  maxTurns: number
  maxUnits: number
  previewWidth: number
  maxVisible: number
  defaultMode: YankMode
}

/** 配置归一化：非法值回退默认（settings.yank） */
export function loadConfig(): YankConfig {
  const cfg = readExtensionConfig('yank')
  const int = (key: string, fallback: number): number => {
    const value = cfg?.[key]
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
  }
  const mode = cfg?.defaultMode
  return {
    maxTurns: int('maxTurns', 20),
    maxUnits: int('maxUnits', 300),
    previewWidth: int('previewWidth', 48),
    maxVisible: int('maxVisible', 12),
    defaultMode: mode === 'codes' || mode === 'questions' ? mode : 'answers',
  }
}

/** 列表当前生效配置（扩展加载时读取，改 settings 后 /reload 或下会话生效） */
export const CONFIG = loadConfig()
