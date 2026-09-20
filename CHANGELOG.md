# Changelog

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
