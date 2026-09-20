# @jl-org/pi-exts

<div align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">中文</a>
</div>

<div align="center">
  <img alt="pi" src="https://img.shields.io/badge/Pi-Extension-4D9ABF?logo=pi&logoColor=white" />
  <img alt="npm-version" src="https://img.shields.io/npm/v/@jl-org/pi-exts?color=red&logo=npm" />
  <img alt="npm-download" src="https://img.shields.io/npm/dm/@jl-org/pi-exts?logo=npm" />
  <img alt="License" src="https://img.shields.io/npm/l/@jl-org/pi-exts?color=blue" />
  <img alt="typescript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="github" src="https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white" />
</div>

> 让 [Pi 编码代理](https://github.com/earendil-works/pi-coding-agent)更好看、更好用：带厂商配额的状态栏、`ask_user` 弹窗提问、`/yank` 选择复制、会话自动命名、句中命令补全，附带 Tokyo Night 主题

## 安装前后对比

<table>
  <tr>
    <th>Before — 原生 pi</th>
    <th>After — 安装 <code>@jl-org/pi-exts</code></th>
  </tr>
  <tr>
    <td><img src="https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/before.png" alt="原生 pi" width="420" /></td>
    <td><img src="https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/after.png" alt="安装 pi-exts" width="420" /></td>
  </tr>
</table>

## 安装

```bash
pi install npm:@jl-org/pi-exts

# 先试用，不写入配置
pi -e npm:@jl-org/pi-exts
```

也可以把 `@jl-org/pi-exts` 加进 `~/.pi/agent/settings.json` 的 `packages` 数组；加 `-l` 则只装进单个项目（`.pi/settings.json`）：

```jsonc
{
  "packages": ["npm:@jl-org/pi-exts"]
}
```

## 本地开发

直接从本地 clone 安装——pi 直接加载 TypeScript 源码（无构建步骤），改完 `/reload` 即生效：

```bash
git clone https://github.com/beixiyo/pi-exts.git
pi install ./pi-exts          # 本地路径写入 settings
pi -e ./pi-exts               # 或临时试跑工作区，不落盘
```

## 只启用部分扩展

本包含 7 个扩展，三种方式精确控制启用哪些：

**1. 交互式** —— 安装后在 `pi config` 里逐个开关

**2. 白名单** —— 在 `settings.json` 里只列出想要的扩展：

```jsonc
{
  "packages": [
    {
      "source": "npm:@jl-org/pi-exts",
      "extensions": ["extensions/yank/index.ts", "extensions/statusline/index.ts"]
    }
  ]
}
```

**3. 排除法** —— 全量加载，黑名单排除：

```jsonc
{
  "packages": [
    { "source": "npm:@jl-org/pi-exts", "extensions": ["!extensions/statusline/index.ts"] }
  ]
}
```

## 内容一览

| 扩展 | 提供 | 功能 |
|------|------|------|
| `ask-user` | `ask_user` 工具 | 一次调用依次弹窗提问——选项 + 自定义答案、单选/多选，规整 Q/A 结果返回 |
| `yank` | `/yank` | 选择并复制回复/代码块/问题——树形选择器，支持模式切换、展开收起、模糊过滤 |
| `rename` | `/rename` | 首轮对话后自动命名会话（可用低成本模型）；`/rename <标题>` 手动命名 |
| `status` | `/status` | 会话信息卡片（恢复命令、工作目录、模型、上下文用量）——自动复制到剪贴板，方便其他 Agent 接力 |
| `statusline` | footer | 彩色状态栏：模型、思考级别、git 分支、扩展状态、上下文用量、厂商配额 |
| `slash-anywhere` | 补全 | 句中触发 `/命令` 与 skill 补全（`$cmd` 自动、`/cmd` + Tab 手动） |
| `md-code-bg` | 渲染 | markdown 行内代码背景色 |

所有配置都从 `~/.pi/agent/settings.json` 读取，**全部可省略**——每个扩展都有合理默认值

## 各扩展说明

### ask_user

<!-- screenshot: the dialog with an option list + custom answer input, ideally multi-select mode -->
![ask_user](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/ask-user.png)

agent 获得一个 `ask_user` 工具：提问以弹窗呈现而不是纯聊天文本。带 `options` 时用户可从列表选择，也可在底部输入框自定义答案（单焦点交互——打字进输入框，↑↓ 走列表）。`multiple: true` 时 tab 勾选/取消、enter 提交全部勾选项。非交互模式（`-p` / RPC）返回错误而不是挂起

```jsonc
// ~/.pi/agent/settings.json —— 可省略
{
  "askUser": {
    "placeholder": "Custom answer (empty = use selection)" // 工具调用未带 placeholder 时输入框的占位提示
  }
}
```

### /yank

<!-- screenshot: the picker in answers mode with an expanded code block -->
![/yank](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/yank.png)

从会话中挑选内容复制——一字不差

- **Tab** 循环切换三种模式：**answers**（每轮回复）、**codes**（全部代码块平铺）、**questions**（每轮用户消息）
- **→ / ←** 展开收起回复下的代码块（answers 模式）
- **直接输入**按标签与描述模糊过滤
- **↑↓** 移动 · **enter** 复制 · **esc** 取消（支持鼠标点击）

```jsonc
// ~/.pi/agent/settings.json —— 可省略
{
  "yank": {
    "maxTurns": 20,          // 最多展示的消息轮数（各角色独立计数）
    "maxUnits": 300,         // 列表项总数上限
    "previewWidth": 48,      // 首行摘要显示宽度（列）
    "maxVisible": 12,        // 选择器一次可见行数
    "defaultMode": "answers" // answers | codes | questions
  }
}
```

### /rename

首轮请求结束后自动命名会话，用你指定的低成本模型（绝不覆盖已有名称）。`/rename <标题>` 直接命名；`/rename` 按最近对话重新生成

```jsonc
// ~/.pi/agent/settings.json —— 可省略；缺省跟随 pi 默认模型
{
  "autoRename": {
    "model": "zai/glm-5-turbo", // "provider/model" 或 "provider/model:thinking"
    "thinkingLevel": "minimal", // off | minimal | low | medium | high | xhigh | max
    "maxLen": 24                // 标题最大字符数
  }
}
```

### /status

<!-- screenshot: the session status card with the resume command highlighted -->
![/status](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/status.png)

在聊天记录中追加一张持久卡片（不进 LLM 上下文）：会话名、Session ID、会话文件、可直接粘贴的恢复命令、工作目录、git 分支、模型、上下文用量。同等信息自动复制到剪贴板——粘贴给其他 Agent 或新会话，从上次中断处无缝接力

```jsonc
// ~/.pi/agent/settings.json —— 可省略
{
  "statusCard": {
    "copyToClipboard": true // /status 时自动复制等价纯文本
  }
}
```

### Statusline

<!-- screenshot: full-width footer with model/thinking/branch on the left, context% + quotas on the right, session-name badge on the input border -->
![statusline](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/statusline.png)

声明式状态栏：左右段落列表、逐段颜色（主题语义色 / 真彩 hex / 按用量自动变色的 `auto`）、后台节流刷新的厂商配额、嵌入输入框边框的会话名徽标（装饰现有编辑器，与 [pi-vim](https://www.npmjs.com/package/pi-vim) 兼容）

支持的段落——左侧：`model`、`thinking`、`branch`、`sessionName`、`extensionStatus`；右侧：`context`、`quota`（展开为每个有凭证厂商的一段）。配额厂商：GLM Coding Plan（zai）、OpenRouter、DeepSeek、OpenAI（管理 key）。无数据的段自动跳过；窄终端时右侧从尾部逐段丢弃。用量百分比显示为「已用」（如 `ctx 42% used`）

```jsonc
// ~/.pi/agent/settings.json —— 可省略；以下即完整默认值
{
  "statusline": {
    "left": [
      { "type": "model", "color": "#4aa5f0" },
      { "type": "thinking", "color": "#c678dd" },
      { "type": "branch", "color": "#98c379" },
      { "type": "extensionStatus", "color": "#e5c07b" }
    ],
    "right": [
      { "type": "context", "color": "auto" },
      { "type": "quota", "color": "auto" }
    ],
    "autoLevels": {                       // 'auto' 变色：normal 为色板按段轮换，warn/danger 统一警报色
      "warnAt": 70, "dangerAt": 90,
      "normal": ["#4aa5f0", "#6dc7a8", "#42b3c2", "#98c379"], "warn": "#e5c07b", "danger": "#c24038"
    },
    "separator": { "left": " · ", "right": "  ", "color": "#7f848e" },
    "hiddenStatusKeys": ["mcp"],          // 要隐藏的扩展状态键
    "quotaRefreshMs": 60000,              // 配额刷新节流（毫秒）
    "badge": {                            // 输入框边框的会话名徽标
      "enabled": true,
      "bg": "#4aa5f0",                    // fg 缺省按背景亮度自动取对比色
      "maxWidth": null                    // null = 跟随编辑器宽度
    }
  }
}
```

### Slash anywhere

<!-- screenshot: typing mid-sentence with "$" triggering the command autocomplete -->
![slash anywhere](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/slash-anywhere.png)

pi 只在「行首打 /」时提供命令补全。本扩展加入句中补全：空白后打 `$cmd` 自动弹层，或 `/cmd` + Tab 手动触发。`$` 通道默认**只建议 skill**（可用 `autoSources` 调整）；`/` + Tab 手动通道始终建议全部（命令、prompt、skill）。行首 `/` 场景保持 pi 内置行为不变

```jsonc
// ~/.pi/agent/settings.json —— 可省略
{
  "slashAnywhere": {
    "autoTriggerChars": ["$"],   // 自动触发符（单个符号）；/ 始终走 Tab 手动触发
    "autoSources": ["skill"]    // $ 通道补全什么：extension | prompt | skill 任意组合
  }
}
```

### 行内代码背景

markdown 行内 `` `代码` `` 以背景色渲染。fenced 代码块不受影响。效果见顶部安装前后对比图

> 注意：依赖 pi markdown 管线的 ANSI 透传行为。若 pi 更新后失效，扩展只是不再生效

```jsonc
// ~/.pi/agent/settings.json —— 可省略
{
  "mdCodeBg": {
    "enabled": true,
    "fg": "#42b3c2",   // 前景色
    "bg": "#313244"    // 背景色
  }
}
```

## 主题：pretty-cat

包内附带 **pretty-cat** 主题——Tokyo Night 变体色板，statusline 与行内代码的默认配色均按它调校。在 `/settings` 里选择，或：

```jsonc
// ~/.pi/agent/settings.json
{
  "theme": "pretty-cat"
}
```

不想要主题？用 `pi config` 关掉，或直接过滤：

```jsonc
{ "source": "npm:@jl-org/pi-exts", "themes": [] }
```

## 配置作用域

配置从 `~/.pi/agent/settings.json`（全局）与 `<项目>/.pi/settings.json`（项目顶层键覆盖全局）合并读取。修改后 `/reload` 或重启 pi 生效。非法值回退默认值——写错配置不会弄坏状态栏或命令

## 隐私与安全

- **读取**：`settings.json`、`auth.json`（只读——配额 adapter 只查自己的 API key）、经 pi API 读取会话数据
- **网络**：只访问厂商配额/计费端点（z.ai / bigmodel.cn、openrouter.ai、api.deepseek.com、api.openai.com），且只对 `auth.json` 中存在凭证的厂商发起；外加每会话一次自动命名的 LLM 调用（用你配置的模型）
- **写入**：除 pi 自身的会话命名 API 外不写任何文件。剪贴板写入仅发生在显式动作（`/yank`、`/status`）——tmux 内经 OSC 52 转发到真实终端
- 部分配额端点需要特定类型的 key（如 OpenRouter/OpenAI 管理 key）；没有就静默跳过该段

## 我日常在用的其他包

| 包 | 功能 |
|----|------|
| [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | MCP（Model Context Protocol）适配器——让 pi 接入任意 MCP 服务器 |
| [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | 委派与脚本化多 agent 工作流 |
| [`pi-vim`](https://www.npmjs.com/package/pi-vim) | pi 编辑器的 Vim 模态编辑 |
| [`@ff-labs/pi-fff`](https://www.npmjs.com/package/@ff-labs/pi-fff) | FFF 驱动的模糊文件与内容搜索 |

```jsonc
// ~/.pi/agent/settings.json
{
  "packages": [
    "npm:pi-mcp-adapter",
    "npm:pi-subagents",
    "npm:pi-vim",
    "npm:@ff-labs/pi-fff"
  ]
}
```
