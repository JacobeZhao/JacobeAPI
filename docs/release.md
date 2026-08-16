# 发布流程

## GitHub 自动更新

桌面端从以下地址检查签名更新：

`https://github.com/JacobeZhao/JacobeAPI/releases/latest/download/latest.json`

首次发布前，在 GitHub 仓库 `Settings > Secrets and variables > Actions` 新建：

- `TAURI_SIGNING_PRIVATE_KEY`：本机 `C:\Users\23743\.tauri\jacobeapi.key` 的完整内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：本机 `C:\Users\23743\.tauri\jacobeapi-password.txt` 的完整内容。

私钥不得提交到 Git。丢失私钥后，已安装客户端无法验证后续更新。

发布桌面新版本时，同时更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的版本号。只有 Chrome 扩展行为或产物发生变化时才更新 `public/manifest.json`。提交后创建并推送标签：

```powershell
git tag v0.1.3
git push origin main --tags
```

GitHub Actions 会运行检查、构建签名 NSIS 安装包、创建 Release，并上传 Windows updater 元数据；随后构建 Universal macOS DMG 和签名 updater 包，并把 macOS 条目合并到同一个 `latest.json`。手动运行 workflow 只生成可下载的 macOS 测试 artifact。客户端启动时静默检查；用户也可在“数据与备份 > 应用更新”中手动检查和安装。

不要手工编辑 `latest.json` 或替换 Release 中的签名文件。

1. 从干净依赖安装开始运行质量检查：

   ```powershell
   npm ci
   npm run lint
   npm run typecheck
   npm run test
   npm run test:e2e
   npm audit --audit-level=high
   ```

2. 生成并检查发布包：

   ```powershell
   npm run package
   npm run verify:package
   ```

3. 将 `release/jacobeapi-v<version>.zip` 解压到临时目录，通过 `chrome://extensions` 加载并完成冒烟测试。
4. 检查商店页面中的单一用途说明、权限理由、截图、支持信息和隐私政策链接。
5. 更新版本号和 `CHANGELOG.md` 后再提交 Chrome Web Store。

不要用无法理解当前数据 schema 的旧版本直接回滚。需要回退功能时，应保留当前迁移和读取能力，从最新分支构建修复版本。
