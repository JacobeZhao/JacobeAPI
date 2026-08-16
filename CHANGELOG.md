# Changelog

## Unreleased

## 0.1.2

- Demo 账户可以使用模拟密钥完整测试 Codex 与 Claude Code 的配置预览、备份、写入和恢复。
- 模拟密钥由本机凭据助手按需输出，不会进入前端、IPC、配置预览或配置文件。
- 修正 Codex 自定义提供商命令认证配置，兼容当前官方 `auth.command` 约定。
- 正式账户在上游模型与网关密钥接口接入前继续阻止新配置写入。

## 0.1.1

- 产品展示名称更新为 JacobeAPI。
- 保留 `com.jacobe.skills`、`jacobe-skills` 数据格式和内部 binary/package 名称，确保旧版资料与 Windows 安装升级兼容。
- Chrome 扩展发布包改名为 `jacobeapi-v<version>.zip`。
- 账户注册入口通过系统浏览器打开 `https://netapi.cc/`。
- 桌面版支持启动检查、手动检查和签名下载安装更新。
- GitHub 标签发布会生成 NSIS 安装包、签名和 `latest.json`。

## 0.1.0

- 首个本地开发版本。
- 支持 Skill 与 MCP 卡片、侧边栏、搜索、标签、复制、导入导出和本地持久化。
