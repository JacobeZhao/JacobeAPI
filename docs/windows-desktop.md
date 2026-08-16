# JacobeAPI Windows 桌面版指南

JacobeAPI Windows 桌面版是离线优先的本地应用，支持 Windows 10 22H2 和 Windows 11 x64。桌面版包含悬浮球、快速面板、完整管理窗口和系统托盘。

## 安装

桌面版使用当前用户范围的 NSIS 安装包，通常不需要管理员权限。

1. 获取与系统架构匹配的 `JacobeAPI` x64 `setup.exe`。
2. 退出正在运行的旧版 JacobeAPI；从 Jacobe Skills 升级时也需先退出旧程序。
3. 双击安装包并按提示完成安装。
4. 从开始菜单启动 JacobeAPI。

应用使用 Microsoft Edge WebView2。Windows 11 和大多数仍受支持的 Windows 10 设备已包含 WebView2；若系统缺少运行时，当前安装包会联网下载引导程序。

### SmartScreen 提示

当前 Alpha 构建可能没有代码签名。首次运行时，Windows SmartScreen 可能显示“Windows 已保护你的电脑”或“无法验证发布者”。

- 只安装来自项目维护者或自己构建的安装包。
- 无法确认来源时，请取消安装。
- 对可信的 Alpha 构建，可检查文件来源与校验值后，通过“更多信息”查看发布者信息和继续选项。
- 面向公众测试前，应使用受信任的代码签名证书签署安装包，或改由 Microsoft Store 分发，不能把绕过 SmartScreen 当作普通用户的常规安装步骤。

## 日常使用

- 首次正常启动会打开完整管理窗口，并默认进入桌面首页；Chrome 扩展仍直接进入本地资料库，不使用桌面首页或账户解锁流程。
- 单击桌面悬浮球可显示或隐藏快速面板。
- 拖动悬浮球后松开，它会吸附到当前显示器边缘并记住位置。
- 快速面板适合搜索、按标签或收藏筛选，以及复制提示词或 MCP 配置。
- 完整管理窗口用于新建、编辑、删除、备份和恢复资料。
- “账户与用量”用于连接 netapi.cc、查看今日 Token、余额和排行榜。当前开发构建显示的是模拟数据，正式 API 接入后才会显示真实账户数据。
- 未登录或登录已过期时，桌面版最多保存 3 个 Skill 和 3 个 MCP，预置内容计入额度。登录后解除该产品额度，但资料格式、安全校验和总量保护仍然有效。
- 升级前已超过 3 个的 Skill 或 MCP 不会被删除或截断。访客可继续查看、复制、编辑、收藏和删除现有内容，但不能让对应类型的数量净增长；Skill 与 MCP 分别计算。
- Chrome 扩展保持无限本地资料库。Chrome 与桌面端存储独立，桌面登录状态不会同步或改变 Chrome 额度。
- 快速面板底部只读显示今日 Token 与余额；进入完整账户页请使用顶部的“打开桌面”按钮。悬浮球本身不显示余额等私人信息。
- Demo 账户可使用明确标注的模拟凭据测试 Codex/Claude Code 配置。配置必须先生成脱敏预览，确认后才会创建备份并写入；配置文件被其他程序修改时，旧预览会失效。模拟凭据不能用于正式 API 调用，但测试流程会修改真实的本机配置文件。
- Demo 登录凭据使用 Windows Credential Manager 保存，应用重启后可恢复会话；退出登录会清除该凭据。损坏或无法读取的本机凭据按未登录处理，不会从普通文件恢复。正式账户的恢复、服务端撤销和 entitlement 仍需 netapi.cc 上游接口支持。
- 其他账户在正式模型目录与网关密钥接口接入前不能生成新配置。已有本地备份始终可以恢复，恢复操作同样需要由用户主动点击。
- 关闭管理窗口只会隐藏窗口，应用仍保留在系统托盘。
- 托盘菜单可重新打开管理窗口、显示或隐藏悬浮球、切换开机启动，以及真正退出应用。

若快速面板或悬浮球没有出现，先检查系统托盘中的 JacobeAPI；选择显示悬浮球或打开管理窗口即可恢复入口。

## 从 Chrome 扩展手动迁移

Chrome 扩展与 Windows 桌面版使用彼此独立的本地存储，不会自动同步，也不会直接读取对方的数据。

1. 在 Chrome 扩展侧边栏点击顶部的“打开桌面”。
2. 打开“数据与备份”，选择“导出 JSON”。
3. 启动 Windows 桌面版并打开完整管理窗口。
4. 在“数据与备份”中选择刚才导出的 JSON 文件。
5. 检查 Skill 数量、MCP 数量和重复项预览。
6. 选择冲突策略后确认导入。首次迁移建议保留默认的“跳过重复”。
7. 抽查常用 Skill 和 MCP 配置，确认无误后再决定是否卸载 Chrome 扩展。

迁移是一次手动复制，不会建立后续同步。迁移后在 Chrome 或桌面版做出的修改不会自动出现在另一端。

## 本地数据与备份

桌面版使用 Tauri 的当前用户本地应用数据目录。为确保 Jacobe Skills 旧版本可以原地升级且资料不会丢失，应用标识继续使用 `com.jacobe.skills`，在常规 Windows 安装中通常位于：

```text
%LOCALAPPDATA%\com.jacobe.skills\
```

主要内容：

```text
com.jacobe.skills\
├── desktop-settings.json
└── library\
    ├── meta.json
    ├── slot-a.json
    └── slot-b.json
```

`library` 使用两个交替数据槽和元数据文件降低写入中断导致的数据损坏风险。这些文件是应用内部状态，不建议手工编辑。跨版本备份和迁移应使用管理窗口导出的版本化 JSON 文件。

界面和安装包使用 JacobeAPI 品牌，但内部仍保留 `jacobe-skills.exe`、Rust/npm package 名 `jacobe-skills`，导出文件中的 `format` 也继续为 `jacobe-skills`。这些名称是升级、CLI helper 路径和备份兼容标识，不应手工改名。

AI 工具配置备份位于应用本地数据目录的 `cli-config-backups` 子目录，并与资料库导出相互独立。备份内容经本机保护后保存，只接受应用生成的 ID，不允许从界面选择任意路径恢复。退出 netapi.cc 账户不会静默恢复或删除已应用的 Codex/Claude Code 配置。

Claude Code 配置只替换 JacobeAPI 明确管理的网关、模型和凭据助手字段，未知根字段与未知环境字段会原样保留。应用在确认写入前比较预览时记录的文件状态；若文件已被其他程序修改，必须重新预览。目标 `.codex` 或 `.claude` 目录不存在时，预览不会创建目录，用户确认应用后才创建受管目录；应用拒绝把重解析点或符号链接当作首次创建目标。

使用 Demo 账户执行一键配置时，应用仍遵循相同的预览、确认、自动备份和冲突检测流程。界面不会显示模拟密钥原文。完成测试后，可在“账户与用量”页面的“最近备份”中恢复原配置；恢复后应重启对应的 Codex 或 Claude Code 进程。

MCP 环境变量可能包含敏感内容。导出或分享备份前应检查 JSON；更推荐保存 `${ENV_VAR}` 一类占位符，而不是真实密钥。

## 卸载与彻底删除

卸载器会移除应用程序文件和快捷方式，但不会自动删除 `%LOCALAPPDATA%\com.jacobe.skills\` 中的用户资料。这样可以避免误卸载导致 Skill 和 MCP 数据丢失，重装后原数据也可能继续可用。

若需要彻底删除：

1. 在管理窗口导出需要保留的 JSON 备份。
2. 从托盘菜单选择退出，确认 JacobeAPI 已停止运行。
3. 卸载 JacobeAPI。
4. 在文件资源管理器地址栏输入 `%LOCALAPPDATA%\com.jacobe.skills\`。
5. 确认路径无误后删除该目录。

手动删除本地数据不可撤销。

## 开发环境

Windows 桌面构建必须使用 MSVC Rust toolchain。GNU toolchain 不能作为受支持的 Tauri Windows 发布构建环境。

前置条件：

- Node.js 与 npm
- Rust stable MSVC toolchain
- Visual Studio 2022 Build Tools 中的“使用 C++ 的桌面开发”工作负载
- Windows 10/11 SDK
- Microsoft Edge WebView2 Runtime

在项目目录执行：

```powershell
npm ci
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup override set stable-x86_64-pc-windows-msvc
rustc -Vv
npm run dev:desktop
```

`rustc -Vv` 的 `host` 应为 `x86_64-pc-windows-msvc`。构建和测试：

```powershell
npm run lint
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
npm run build:desktop
```

NSIS 安装包输出到：

```text
src-tauri\target\release\bundle\nsis\
```

正式公开分发前，还需在干净的 Windows 10 22H2 和 Windows 11 x64 环境验证安装、升级、卸载、WebView2 缺失处理和 SmartScreen/签名结果。
