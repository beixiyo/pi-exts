/**
 * Ask User — 把扩展 UI 对话框暴露为 agent 可调用的工具
 *
 * pi 核心没有内置的"问用户"工具（交互模型是聊天文本本身），本扩展补齐该能力
 * 工具定义与多轮执行见 ./tool.ts，对话框组件见 ./dialog.ts
 *
 * ## 配置（~/.pi/agent/settings.json 的 askUser 键，可省略）
 *   {
 *     "askUser": {
 *       "placeholder": "Custom answer (empty = use selection)"  // 工具调用未带 placeholder 时的输入框占位符
 *     }
 *   }
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { askUserTool } from './tool'

export default function(pi: ExtensionAPI) {
  pi.registerTool(askUserTool)
}
