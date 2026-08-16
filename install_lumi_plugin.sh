#!/bin/bash
# 将 macOS 构建产物注册为 Lumi 插件（L2 本地发现）。
# 用法：在 JacobeAPI 仓库根目录执行 ./install_lumi_plugin.sh
set -euo pipefail

APP_NAME="JacobeAPI.app"
SRC_APP="src-tauri/target/release/bundle/macos/${APP_NAME}"
LUMI_PLUGINS="${HOME}/Library/Application Support/Lumi/Plugins"

if [ ! -d "${SRC_APP}" ]; then
  echo "未找到构建产物 ${SRC_APP}，请先执行 npm run tauri build" >&2
  exit 1
fi

echo "写入 lumi-plugin.json ..."
cat > "${SRC_APP}/Contents/Resources/lumi-plugin.json" <<'EOF'
{
  "id": "com.jacobe.skills",
  "name": "JacobeAPI",
  "iconName": "puzzlepiece",
  "appName": "JacobeAPI.app",
  "panelHint": "本地优先的 Skill 与 MCP 配置管理工具",
  "permissions": [
    { "type": "none", "reason": "独立进程运行，权限由 JacobeAPI 自行申请" }
  ]
}
EOF

echo "复制到 ${LUMI_PLUGINS} ..."
mkdir -p "${LUMI_PLUGINS}"
rm -rf "${LUMI_PLUGINS}/${APP_NAME}"
cp -R "${SRC_APP}" "${LUMI_PLUGINS}/${APP_NAME}"
# 本机构建的产物无 quarantine 属性，无需去隔离；保险起见仍执行一次
xattr -dr com.apple.quarantine "${LUMI_PLUGINS}/${APP_NAME}" 2>/dev/null || true

echo "完成。重启 Lumi 后，插件面板会出现「JacobeAPI」。"
