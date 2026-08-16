# JacobeAPI 隐私说明

更新时间：2026-08-16

JacobeAPI 的首要原则是让用户掌控自己的内容。Chrome 扩展不包含账号或网络功能；Windows 桌面版可由用户主动连接 netapi.cc 账户。两个版本都不会向 netapi.cc 或其他第三方发送用户的 Skill、提示词、标签或 MCP 配置，也不包含遥测或云同步。

## Chrome 扩展的数据处理

- Skill、提示词、标签、MCP 配置和界面偏好仅保存在本机的 `chrome.storage.local`。
- 扩展不读取网页内容，也不申请网站访问权限。
- `storage` 权限用于保存本地资料和界面偏好。
- `sidePanel` 权限用于提供快速搜索与复制界面。
- `clipboardWrite` 仅在用户点击复制按钮后写入所选内容。
- 用户主动导出的 JSON 或 Markdown 文件由用户自行保存和管理。

卸载扩展或清理扩展数据会删除 Chrome 版内容，请提前导出 JSON 备份。

## Windows 桌面版的数据处理

- 桌面版资料保存在当前 Windows 用户的本地应用数据目录。为兼容旧版本，应用标识继续使用 `com.jacobe.skills`，通常对应 `%LOCALAPPDATA%\com.jacobe.skills\`。
- Skill 与 MCP 资料位于 `library` 子目录，悬浮球位置和桌面偏好位于 `desktop-settings.json`。
- 桌面版只在用户主动操作时写入剪贴板、打开 JSON 文件或保存 JSON/Markdown 文件。
- 开机启动仅在用户主动启用后注册；可在应用设置或托盘菜单中关闭。
- 桌面版不会读取 Chrome 扩展存储。两个版本之间仅通过用户主动导出和导入的 JSON 文件迁移数据。
- 用户主动登录 netapi.cc 后，桌面版只交换登录、账户摘要、今日 Token、余额、排行榜和可用模型所需的账户数据。排行榜名称应由服务端脱敏。
- 当前开发版本使用标为“模拟数据”的本机 adapter，不发起 netapi.cc 请求，并使用仅存活于当前进程的会话凭据。正式接口启用前必须改用 Windows 安全凭据存储并更新本说明。
- 正式一键配置启用后，会在用户查看脱敏预览并确认后读取和修改 `~/.codex/config.toml` 或 `~/.claude/settings.json`。写入前会创建受保护备份，失败时尝试自动恢复；用户也可从账户页恢复已有备份。当前 mock 阶段只检测配置，不会生成可应用的预览。

卸载 Windows 桌面应用不会自动删除上述本地数据目录。这用于避免误卸载造成资料丢失，也意味着重装后资料可能仍然存在。若要彻底删除数据，请先退出 JacobeAPI、按需导出备份，然后手动删除 `%LOCALAPPDATA%\com.jacobe.skills\`。删除后无法由应用恢复。

## 安全提示

- 浏览器扩展存储和 Windows 本地应用数据目录都不是加密保险库。
- 请勿保存密码、真实 API Key、Token 或其他秘密；MCP 配置应使用 `${ENV_VAR}` 一类环境变量占位符。
- JacobeAPI 不会执行 Skill 或 MCP 内容中的命令，也不会安装其他程序。只有桌面版“一键配置”会在用户明确确认后修改受支持的 Codex/Claude Code 配置字段。
- 当前未签名的 Windows Alpha 安装包可能触发 SmartScreen。只应运行来自可信来源的构建；公开测试版本应使用代码签名或 Microsoft Store 分发。
