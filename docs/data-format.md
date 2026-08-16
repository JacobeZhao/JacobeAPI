# 数据格式

JacobeAPI 导出文件使用版本化 JSON envelope。为保证已有备份可以继续导入，格式标识仍为 `jacobe-skills`：

```json
{
  "format": "jacobe-skills",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "exportedAt": "2026-08-15T12:00:00.000Z",
  "data": {
    "schemaVersion": 1,
    "revision": 3,
    "skills": [],
    "mcps": [],
    "preferences": {
      "managerView": "skills",
      "sort": "updated-desc"
    }
  }
}
```

## 限制

- 单个导入文件和单个存储槽最多 4 MiB。
- Skill 与 MCP 卡片合计最多 2,000 个。
- 名称最多 120 个字符，描述最多 600 个字符。
- 提示词或安装说明最多 100 KiB。
- 每张卡片最多 20 个标签，每个标签最多 32 个字符。

标签在保存时会清理首尾空格并进行 Unicode NFKC 规范化；同一卡片内不区分大小写去重。

## 导入冲突

- `跳过重复`：默认策略，保留当前卡片。
- `覆盖重复`：以导入文件中相同 ID 的卡片替换当前卡片。
- `替换整个库`：删除当前库并使用导入内容，需要额外确认。

导入按照“大小检查、JSON 解析、严格 schema 校验、冲突预览、确认、提交”的顺序执行。任一步失败都不会部分写入。
