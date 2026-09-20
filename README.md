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

> Polish & level up the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent): a statusline with provider quotas, `ask_user` dialogs, a `/yank` picker, auto session naming, mid-sentence slash completion, and a bundled Tokyo Night theme.

## Before / After

<table>
  <tr>
    <th>Before — stock pi</th>
    <th>After — with <code>@jl-org/pi-exts</code></th>
  </tr>
  <tr>
    <td><img src="https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/before.png" alt="stock pi" width="420" /></td>
    <td><img src="https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/after.png" alt="pi with pi-exts" width="420" /></td>
  </tr>
</table>

## Install

```bash
pi install npm:@jl-org/pi-exts

# try it first without installing
pi -e npm:@jl-org/pi-exts
```

Add `@jl-org/pi-exts` to the `packages` array in `~/.pi/agent/settings.json`, or use `-l` to install into a single project (`.pi/settings.json`) instead:

```jsonc
{
  "packages": ["npm:@jl-org/pi-exts"]
}
```

### Local development

Install straight from a local checkout — pi loads the TypeScript sources directly (no build step), so edits take effect on `/reload`:

```bash
git clone https://github.com/beixiyo/pi-exts.git
pi install ./pi-exts          # add the local path to settings
pi -e ./pi-exts               # or try the working tree without saving
```

## Install only what you want

This package ships 7 extensions. Pick exactly the ones you want — three ways:

**1. Interactive** — after installing, toggle each extension on/off in `pi config`.

**2. Allowlist** — list only the extensions you want in `settings.json`:

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

**3. Exclude** — load everything except what you blacklist:

```jsonc
{
  "packages": [
    { "source": "npm:@jl-org/pi-exts", "extensions": ["!extensions/statusline/index.ts"] }
  ]
}
```

## Contents

| Extension | Adds | What it does |
|-----------|------|--------------|
| `ask-user` | `ask_user` tool | Sequential pop-up dialogs in one call — option list + custom answer, single/multi select, tidy Q/A results |
| `yank` | `/yank` | Pick and copy any reply, code block, or question — tree picker with mode cycling, expand/collapse, fuzzy filter |
| `rename` | `/rename` | Auto-name the session after the first turn (cheap model of your choice); `/rename <title>` to set manually |
| `status` | `/status` | Session info card (resume command, cwd, model, context usage) — auto-copied to the clipboard for handoff to another agent |
| `statusline` | footer | Colorful statusline: model, thinking level, git branch, extension statuses, context usage, provider quotas |
| `slash-anywhere` | completion | Trigger `/command` and skill completion mid-sentence (`$cmd` auto, `/cmd` + Tab manual) |
| `md-code-bg` | rendering | Colored background for markdown inline code |
| `pretty-cat` | theme | Tokyo Night–derived theme the bundled colors are tuned against |

All configuration lives in `~/.pi/agent/settings.json` and is **entirely optional** — every extension ships with sensible defaults.

## Extensions

### ask_user

<!-- screenshot: the dialog with an option list + custom answer input, ideally multi-select mode -->
![ask_user](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/ask-user.png)

The agent gets an `ask_user` tool: questions as pop-up dialogs instead of plain chat text. Pass `questions: [...]` to ask several questions in sequence — each gets its own dialog and the result comes back as a tidy Q/A list; canceling at any point still returns the answers collected so far. With `options`, users pick from a list or type a custom answer at the bottom (single focus — typing goes to the input, ↑↓ goes to the list). With `multiple: true`, tab toggles checkboxes and enter submits all checked items. In non-interactive mode (`-p` / RPC) it returns an error instead of hanging.

```jsonc
// ~/.pi/agent/settings.json — optional
{
  "askUser": {
    "placeholder": "Custom answer (empty = use selection)" // input-box placeholder when the tool call omits one
  }
}
```

### /yank

<!-- screenshot: the picker in answers mode with an expanded code block -->
![/yank](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/yank.png)

Pick content from the conversation and copy it — exactly as it was written.

- **Tab** cycles three modes: **answers** (each reply), **codes** (all code blocks flat), **questions** (each user message)
- **→ / ←** expand or collapse a reply's code blocks (answers mode)
- **Type** to fuzzy-filter by label and description
- **↑↓** move · **enter** copy · **esc** cancel (mouse clicks supported)

```jsonc
// ~/.pi/agent/settings.json — optional
{
  "yank": {
    "maxTurns": 20,          // max turns listed per role
    "maxUnits": 300,         // max list items in total
    "previewWidth": 48,      // first-line preview width in columns
    "maxVisible": 12,        // picker rows visible at once
    "defaultMode": "answers" // answers | codes | questions
  }
}
```

### /rename

Names the session automatically after the first turn settles, using a cheap model of your choice (never overwrites an existing name). `/rename <title>` names it directly; `/rename` regenerates from the recent conversation.

```jsonc
// ~/.pi/agent/settings.json — optional; omit to follow pi's default model
{
  "autoRename": {
    "model": "zai/glm-5-turbo", // "provider/model" or "provider/model:thinking"
    "thinkingLevel": "minimal", // off | minimal | low | medium | high | xhigh | max
    "maxLen": 24                // max title length in characters
  }
}
```

### /status

<!-- screenshot: the session status card with the resume command highlighted -->
![/status](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/status.png)

Appends a persistent card to the transcript (not sent to the LLM) with session name, ID, session file, a ready-to-paste resume command, cwd, git branch, model, and context usage. The same info is automatically copied to the clipboard — paste it into another agent or a fresh session to pick up where you left off.

```jsonc
// ~/.pi/agent/settings.json — optional
{
  "statusCard": {
    "copyToClipboard": true // auto-copy the plain-text version when /status runs
  }
}
```

### Statusline

<!-- screenshot: full-width footer with model/thinking/branch on the left, context% + quotas on the right, session-name badge on the input border -->
![statusline](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/statusline.png)

A declarative footer: left/right segment lists, per-segment colors (theme color, truecolor hex, or `auto` for usage-based coloring), provider quotas refreshed in the background, and a session-name badge embedded in the input border (delegates to the existing editor — works with [pi-vim](https://www.npmjs.com/package/pi-vim)).

Supported segments — left: `model`, `thinking`, `branch`, `sessionName`, `extensionStatus`; right: `context`, `quota` (expands to that provider's quota segments). Quota providers: GLM Coding Plan (zai), OpenAI Codex subscription (ChatGPT sign-in, via the same `/wham/usage` endpoint as codex CLI's `/status`), OpenRouter, DeepSeek, OpenAI (admin key). Only the current model's provider quota is fetched and shown; switching models refetches immediately. Segments without data are skipped; on narrow terminals right segments drop from the tail. Usage percentages read as *used* (e.g. `ctx 42% used`).

```jsonc
// ~/.pi/agent/settings.json — optional; this is the full default
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
    "autoLevels": {                       // 'auto' coloring: normal is a palette cycled per segment; warn/danger are unified alert colors
      "warnAt": 70, "dangerAt": 90,
      "normal": ["#4aa5f0", "#6dc7a8", "#42b3c2", "#98c379"], "warn": "#e5c07b", "danger": "#c24038"
    },
    "separator": { "left": " · ", "right": "  ", "color": "#7f848e" },
    "hiddenStatusKeys": ["mcp"],          // extension status keys to hide
    "quotaRefreshMs": 60000,              // quota refresh throttle
    "badge": {                            // session-name badge on the input border
      "enabled": true,
      "bg": "#4aa5f0",                    // fg defaults to auto-contrast
      "maxWidth": null                    // null = follow editor width
    }
  }
}
```

### Slash anywhere

<!-- screenshot: typing mid-sentence with "$" triggering the command autocomplete -->
![slash anywhere](https://github.com/beixiyo/pi-exts/releases/download/v0.1.0/slash-anywhere.png)

pi only offers command completion when `/` starts the line. This adds mid-sentence completion: type `$cmd` after a space to trigger automatically, or `/cmd` + Tab manually. The `$` channel suggests **skills only** by default (`autoSources`); the `/` + Tab channel suggests everything (commands, prompts, skills). Line-leading `/` keeps pi's built-in behavior untouched.

```jsonc
// ~/.pi/agent/settings.json — optional
{
  "slashAnywhere": {
    "autoTriggerChars": ["$"],    // single symbols that auto-trigger; '/' always works via Tab
    "autoSources": ["skill"]     // what the "$" channel suggests: extension | prompt | skill, any combination
  }
}
```

### Inline code background

Renders markdown inline `` `code` `` with a colored background block. Fenced code blocks are untouched. See the Before/After comparison at the top for the effect.

> Note: relies on ANSI passthrough in pi's markdown pipeline. If a pi update breaks it, the extension simply has no effect.

```jsonc
// ~/.pi/agent/settings.json — optional
{
  "mdCodeBg": {
    "enabled": true,
    "fg": "#42b3c2",   // text color
    "bg": "#313244"    // background color
  }
}
```

## Theme: pretty-cat

The package ships the **pretty-cat** theme — a Tokyo Night–derived palette that the statusline and inline-code defaults are tuned against. Select it in `/settings`, or:

```jsonc
// ~/.pi/agent/settings.json
{
  "theme": "pretty-cat"
}
```

Don't want it? Use `pi config` or filter it out:

```jsonc
{ "source": "npm:@jl-org/pi-exts", "themes": [] }
```

## Configuration scope

Settings are read from `~/.pi/agent/settings.json` (global) merged with `<project>/.pi/settings.json` (project top-level keys override). After editing, run `/reload` or restart pi. Invalid values fall back to defaults — a broken config never breaks the footer or commands.

## Privacy & security

- **Reads**: `settings.json`, `auth.json` (read-only — quota providers look up their own API keys), session data via pi APIs.
- **Network**: only provider quota/billing endpoints (z.ai / bigmodel.cn, chatgpt.com/backend-api, openrouter.ai, api.deepseek.com, api.openai.com), and only for providers whose keys exist in `auth.json`. Plus one LLM call per session for auto-rename, using your configured model.
- **Writes**: nothing outside pi's own session-name API. Clipboard writes happen only on explicit actions (`/yank`, `/status`) — with OSC 52 forwarding when inside tmux.
- Quota endpoints need specific key types (e.g. OpenRouter/OpenAI management keys); if absent, the segment is simply skipped.

## Other packages I use daily

| Package | What it does |
|---------|--------------|
| [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | MCP (Model Context Protocol) adapter — use any MCP server with pi |
| [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | Delegation and scripted multi-agent workflows |
| [`pi-vim`](https://www.npmjs.com/package/pi-vim) | Vim-style modal editing for pi's editor |
| [`@ff-labs/pi-fff`](https://www.npmjs.com/package/@ff-labs/pi-fff) | FFF-powered fuzzy file and content search |

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
