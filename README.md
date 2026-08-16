# JacobeAPI

JacobeAPI 是一个本地优先的 Skill 与 MCP 配置管理工具。Skill、提示词、标签和 MCP 配置始终保存在本机；Windows 桌面版还可由用户主动连接 netapi.cc 账户，查看用量并配置本机 AI 工具。

## Chrome 扩展

### 本地安装

1. 安装依赖并构建：

   ```powershell
   npm ci
   npm run build
   ```

2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本项目的 `dist` 文件夹。
5. 将 JacobeAPI 固定到工具栏，点击图标即可打开侧边栏。

侧边栏用于快速搜索和复制。点击侧边栏右上角的管理按钮，可以打开完整管理页，新建或编辑 Skill 与 MCP 工具。

### 数据与备份

- 数据保存在 Chrome 的扩展本地存储中，不会自动发送到网络。
- 删除扩展或清理扩展数据会删除 Chrome 版的本地内容。
- 在管理页的“数据与备份”中定期导出 JSON；导入前会先校验并显示冲突预览。
- MCP 配置不是加密保险库。请使用 `${ENV_VAR}` 一类占位符，不要保存真实 API Key、Token 或密码。
- “下载 Skill”“复制使用说明”和“复制 MCP 配置”都不会执行命令或修改电脑上的其他程序。

## Windows 桌面版 Alpha

桌面版支持 Windows 10 22H2 和 Windows 11 的 x64 系统。它提供常驻托盘、桌面悬浮球、快速面板和完整管理窗口。

Windows 桌面版与 Chrome 扩展使用不同的本地存储，不会自动同步。已有 Chrome 数据需要先导出 JSON，再导入桌面版。安装、使用、数据位置、手动迁移和卸载说明见 [Windows 桌面版指南](docs/windows-desktop.md)。

当前账户功能使用清楚标注的模拟数据与可替换 API adapter，因为 netapi.cc 的正式接口仍在开发。模拟登录不会请求 netapi.cc，且进程重启后需要重新登录。正式 HTTP adapter 和 Windows 持久会话凭据将在 API 合同冻结后启用。

本机演示账户为 `demo@netapi.cc`，密码为 `jacobe-demo`。只有这个账号走 mock 数据；其他账号不会被伪装成已登录，正式登录 API 未接入时会返回服务暂不可用。

中转站后端需要开放的接口、字段和安全约束见 [netapi.cc 桌面客户端 API 合同](docs/netapi-api-contract.md)。

“一键配置”引擎仅支持 Codex 的 OpenAI Responses 直连配置与 Claude Code 的 Anthropic Messages 直连配置。应用会先展示脱敏预览，只有用户确认后才备份并修改目标配置；不包含本地代理或协议转换。当前 mock 阶段只检测本机配置，正式模型与网关 Key 接口接入前会阻止预览和写入。

当前 Alpha 安装包可能尚未进行代码签名，因此 Windows SmartScreen 可能显示“Windows 已保护你的电脑”。仅运行来自可信构建来源的安装包。面向公众测试的安装包应先完成代码签名，或通过 Microsoft Store 分发。

## 开发与验证

安装 JavaScript 依赖：

```powershell
npm ci
```

Chrome 扩展：

```powershell
npm run dev
npm run build:extension
npm run test:e2e
npm run verify:package
npm run package:extension
```

Windows 桌面版必须使用 Rust MSVC toolchain，并安装 Visual Studio C++ Build Tools、Windows SDK 与 WebView2 Runtime：

```powershell
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup override set stable-x86_64-pc-windows-msvc
npm run dev:desktop
npm run build:desktop
```

通用检查：

```powershell
npm run lint
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

生产扩展位于 `dist`，扩展发布压缩包位于 `release`。桌面 UI 位于 `dist-desktop`，Windows NSIS 安装包位于 `src-tauri/target/release/bundle/nsis`。

为保证旧版本可原地升级并继续读取本地资料，桌面应用仍使用 `com.jacobe.skills` 作为应用标识，并保留 `jacobe-skills` 作为内部 package、binary 和导出格式兼容标识。这些内部名称不影响界面中显示的 JacobeAPI 品牌。

## 支持范围

- Google Chrome 114 及以上版本
- Windows、macOS 和 Linux 上的桌面 Chrome
- Windows 10 22H2 / Windows 11 x64 桌面应用
- 当前不包含云同步、远程市场、Native Messaging 或协议转换代理
