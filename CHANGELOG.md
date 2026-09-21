# Changelog

## 0.3.0 - 2026-09-21

### 新增

- **ask_user 弹窗图片粘贴**：ctrl+v（`app.clipboard.pasteImage`）与主输入框对齐——剪贴板图片落盘为 `pi-clipboard-<uuid>.<ext>` 后插入路径作为答案，无图片回退粘贴文本
- **statusline context 段风格与文案定制**：`contextStyle` 四种显示风格（`pct` / `pct-used`（默认，百分比 + 已用 tokens）/ `pct-total` / `used-total`）；`labels` 覆盖内置英文文案（`ctx` / `used` / `thinking` / `noModel`），quota 段的「% used」后缀同样跟随 `used`
- **rename 回答式输出兕底**：`looksLikeReply` 识别模型把会话素材当成对自己的请求而作答（如「我无法访问…」「I can't…」开头）时放弃命名而非落入错误标题

### 变更

- rename：标题生成 prompt 加角色防线（`<transcript>` 包装 + 显式声明素材非请求、不回应不执行）

## 0.2.0 - 2026-09-20

### 新增

- **OpenAI Codex 订阅配额**：新增 `openai-codex` adapter（ChatGPT 登录的 OAuth 凭证），走 codex CLI `/status` 同源的 `chatgpt.com/backend-api/wham/usage` 端点，产出周/5h 窗口用量段与重置倒计时（plus 套餐为 5h 主窗 + 周副窗，pro 套餐 primary 即周窗）
- `lib/quota` 抽出 `parse.ts` 公共解析工具（`asObject` / `asNumber` / `fmtDuration`），各 adapter 复用

### 变更

- **配额跟随当前模型**：statusline 的 quota 段只拉取并显示当前模型 provider 的厂商配额（此前为全量拉取全部有凭证厂商，多窗口显示相同数据）；切换模型立即绕过节流重拉，新数据落地前的间隙不显示旧厂商段
- `ProviderAdapter.fetchQuota` 签名改为接收 `ProviderCredential` 对象（API key 或 OAuth access token、accountId、过期时刻），凭证解析支持 auth.json 的 OAuth 结构（`access` / `accountId` / `expires`）
- `fetchQuotas(provider?)` 支持按 pi provider id 定向拉取；缺省拉全部（供调试/脚本使用）

### 修复

- `openai-codex` OAuth 凭证此前不被凭证解析识别（只认 `entry.key`），现可正常产出配额段

## [0.1.0] - 2026-09-19

初始发布：statusline（声明式彩色 footer + 厂商配额）、ask_user 对话框、`/yank` 剪贴板拾取、会话自动命名、句中斜杠补全、Tokyo Night 主题
