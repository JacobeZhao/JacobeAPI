# JacobeAPI macOS 桌面版

JacobeAPI macOS 桌面版提供与 Windows 桌面版一致的资料库、悬浮球、快速面板、账户和 AI 工具配置入口。发布包为 Universal 应用，同时包含 Apple Silicon (`arm64`) 与 Intel (`x86_64`) 架构，最低支持 macOS 10.15。

## 安装测试版

1. 从 GitHub Actions 的 `jacobeapi-macos-universal` artifact 或对应 GitHub Release 下载 DMG。
2. 打开 DMG，将 `JacobeAPI.app` 拖入“应用程序”。
3. 首次运行未签名、未公证的内部测试版时，Finder 可能提示无法验证开发者。确认安装包来自本项目后，在 Finder 中按住 Control 点击应用并选择“打开”，再在确认框中选择“打开”。也可以前往“系统设置 > 隐私与安全性”，在被阻止应用的提示旁选择“仍要打开”。

不要为了绕过 Gatekeeper 而全局关闭系统安全检查。未签名测试版只适合受控测试，不应作为面向普通用户的正式发布包。

## 数据与本机配置

桌面数据位于当前用户的 macOS Application Support 目录中，应用标识继续使用 `com.jacobe.skills` 以保持升级兼容。Codex 和 Claude Code 配置分别使用当前用户主目录下的 `.codex` 与 `.claude`。应用仅在用户确认预览后写入受管字段，并在写入前创建备份。

账户会话必须保存在 macOS Keychain 中，不应回退到明文文件。正式 API 接入前，Demo 账户仍只使用明确标注的模拟数据。

## 构建与验证

macOS 包只能在 macOS 上构建。安装 Node.js 22、Rust stable 和 Xcode Command Line Tools 后执行：

```bash
npm ci
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run lint
npm run typecheck
npm test
npm run tauri -- build --target universal-apple-darwin --bundles app,dmg
npm run verify:macos-package
```

输出目录：

```text
src-tauri/target/universal-apple-darwin/release/bundle/macos/JacobeAPI.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

校验脚本会使用 `lipo` 确认应用主程序同时包含 `arm64` 和 `x86_64`，使用 `hdiutil` 验证 DMG；如果应用带有签名，还会使用 `codesign` 严格验证签名。

## GitHub Actions 发布

手动运行 `Release JacobeAPI` workflow 会生成未公证也可下载的 Universal app ZIP 和 DMG artifact，不会创建 GitHub Release。推送 `v*` tag 时，Windows job 先创建 Release 与 Windows updater 条目；macOS job 随后向同一 Release 添加 DMG、签名 updater 包，并由官方 Tauri action 在保留 Windows 条目的基础上合并 macOS updater 元数据。最终 `latest.json` 同时支持 Windows、Apple Silicon 和 Intel 客户端。

正式对外分发需要 Apple Developer Program 的 Developer ID Application 证书和 Apple 公证凭据。在仓库的 `Settings > Secrets and variables > Actions` 中配置：

- `APPLE_CERTIFICATE`：Developer ID Application `.p12` 的 Base64 内容。
- `APPLE_CERTIFICATE_PASSWORD`：导出 `.p12` 时设置的密码。
- `APPLE_SIGNING_IDENTITY`：完整的 Developer ID Application identity。
- `APPLE_ID`：用于公证的 Apple ID。
- `APPLE_PASSWORD`：该 Apple ID 的 app-specific password。
- `APPLE_TEAM_ID`：Apple Developer Team ID。

证书或公证凭据不要提交到 Git。未配置这些 secrets 时，workflow 会继续生成未签名、未公证的内部测试包；配置不完整或无效时，正式签名构建应失败，而不是降级成看似正式的包。

由于透明悬浮球依赖 Tauri 的 macOS private API，当前 DMG 面向 Developer ID 站外分发，不适用于 Mac App Store 上架。若以后要进入 Mac App Store，需要重新设计透明窗口实现并移除该能力。
