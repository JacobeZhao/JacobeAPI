# netapi.cc 桌面客户端 API 合同（建议 v1）

本文档列出 JacobeAPI Windows 桌面版接入 `https://netapi.cc/` 必须由上游提供的接口与语义。当前客户端仍使用确定性的本地 mock；上游合同冻结后再实现 Rust HTTP transport。React/WebView 不直接请求远端。

## 1. 交付物与通用约定

上游需要交付：

- 一份可校验的 OpenAPI 3.1 文档，建议 base URL 为 `https://netapi.cc/api/desktop/v1`。
- 成功与失败响应的脱敏 JSON fixtures，不得包含真实密码、Token、Key、邮箱或手机号。
- 测试/沙箱环境及不会产生真实扣费的测试账户。

所有接口仅允许 HTTPS，使用 `application/json; charset=utf-8`。时间字段均为 ISO 8601 UTC。服务端可以增加响应字段，客户端必须忽略未知新增字段；删除字段、改变类型或语义必须发布新版本。

Access Token 使用 `Authorization: Bearer <token>`。Access Token、Refresh Token 与网关 Key 不得写入普通文件、日志、IPC 响应或前端状态；桌面端将其保存到 Windows Credential Manager 或 macOS Keychain。

整数 Token、请求数和精确金额全部使用十进制字符串，不得使用 JSON number。Token 字符串满足 `^(0|[1-9][0-9]*)$`，金额格式和精度由 `unit` 决定。

## 2. 错误合同

非 2xx 响应统一为：

```json
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "登录已过期",
    "requestId": "req_01J...",
    "details": {}
  }
}
```

客户端仅依赖稳定的 `code`，不解析 `message`。至少支持：

| HTTP | `code` | 客户端行为 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 停止并提示请求无效 |
| 401 | `INVALID_CREDENTIALS` | 登录页提示凭据错误 |
| 401 | `SESSION_EXPIRED` | 删除本机 Access/Refresh Token，清空账户缓存，发布登录过期事件 |
| 403 | `FORBIDDEN` | 提示无权限，不重试 |
| 409 | `CHALLENGE_REQUIRED` | 进入验证码或 2FA 流程 |
| 429 | `RATE_LIMITED` | 遵循 `Retry-After`，禁止紧密重试 |
| 503 | `SERVICE_UNAVAILABLE` | 可退避重试；满足条件时显示旧缓存 |

任何 401 刷新失败均按 `SESSION_EXPIRED` 处理。错误正文不得暴露数据库信息、内部 URL、密钥、上游原文或堆栈。

## 3. 会话接口

### `POST /auth/login`

```json
{
  "identifier": "user@example.com",
  "password": "user-password",
  "challenge": { "id": "optional-id", "code": "optional-code" },
  "device": { "name": "DESKTOP-ABC", "platform": "windows", "appVersion": "0.1.0" }
}
```

成功响应必须包含 `accessToken`、`accessTokenExpiresAt`、`refreshToken`、`refreshTokenExpiresAt`，以及 `user.id`、`user.displayName` 和可选 `user.email`。登录接口必须限流，密码和 challenge code 禁止进入日志。

### `POST /auth/refresh`

请求 `{ "refreshToken": "..." }`。建议每次刷新轮换 Refresh Token；旧 Token 使用后立即失效，检测到重复使用时撤销整个 token family。

### `POST /auth/logout`

撤销当前设备会话并返回 `204 No Content`。重复退出必须幂等。本机即使无法访问远端，也要清除本地凭据和账户缓存。

### `GET /account/me`

返回 `id`、`displayName`、可选 `email`、`status` 和 `rankingVisibility`。排行榜名称必须由服务端脱敏，禁止向其他用户泄露邮箱、手机号、真实姓名或内部数据库主键。

### `GET /account/entitlements`

桌面端必须通过独立、可缓存但可撤销的 entitlement 判断是否解除访客资料库额度，不能从余额、套餐名称、排行榜状态或 HTTP 登录成功自行推断。

```json
{
  "generatedAt": "2026-08-16T08:30:00Z",
  "library": {
    "state": "unlocked",
    "guestLimits": { "skills": "3", "mcps": "3" },
    "expiresAt": "2026-08-16T09:30:00Z"
  }
}
```

`library.state` 固定为 `unlocked` 或 `guest-limited`。`guestLimits` 即使当前已解锁也必须返回，便于客户端在撤销或过期后立即应用访客规则；数值使用十进制字符串。`expiresAt` 是本次授权判定的最晚有效时间，不得晚于当前 Access Token 的有效期。上游需要说明哪些账户状态、套餐和风控事件会变更 entitlement，并在 OpenAPI 中承诺稳定语义。

客户端离线时只可在 `expiresAt` 之前沿用最后一次已验证的 `unlocked` 状态。达到 `expiresAt`、收到 `SESSION_EXPIRED`、用户退出或上游明确返回 `guest-limited` 后，后续新增必须恢复访客额度；已有超额资料不得被裁剪。正式发布不得用“本机仍有 Refresh Token”替代 entitlement 校验。

### 会话恢复、撤销与离线语义

- 应用启动时可从 Windows Credential Manager 或 macOS Keychain 读取 Refresh Token，并调用 `/auth/refresh` 恢复会话；不得把用户密码作为恢复凭据。
- 上游必须定义 Access Token 与 Refresh Token 的绝对过期时间、空闲过期时间、token family 轮换规则和允许的时钟偏差。
- `/auth/logout` 必须撤销当前设备的 token family；上游还应提供撤销所有设备或指定设备会话的账户端能力，并说明撤销传播的最大延迟。
- 本机退出立即清除凭据、账户摘要、排行榜和 entitlement 缓存，即使远端撤销失败；下一次联网不得用已退出的旧 Token 静默恢复。
- 离线、超时和 503 不等于会话失效。客户端可以保留登录身份展示，但只有未超过 `entitlements.expiresAt` 的授权才能继续解除访客额度。
- 任意认证接口返回 `SESSION_EXPIRED` 时，客户端必须 fail closed：清除凭据和私有缓存，进入登录过期状态，并恢复访客新增规则。
- 上游若支持管理员封禁、套餐到期或风控撤销，必须让 `/auth/refresh` 或 `/account/entitlements` 在规定传播时间内反映结果。

## 4. 今日摘要（悬浮面板必需）

### `GET /dashboard/today`

摘要接口不得计算或返回排行榜，悬浮面板只请求该接口。

```json
{
  "generatedAt": "2026-08-16T08:30:00Z",
  "period": {
    "timezone": "Asia/Shanghai",
    "startsAt": "2026-08-15T16:00:00Z",
    "endsAt": "2026-08-16T16:00:00Z"
  },
  "today": {
    "input": "12400",
    "output": "4400",
    "cachedInput": "0",
    "total": "16800",
    "requests": "32"
  },
  "balance": {
    "state": "available",
    "value": "42.50",
    "unit": "CNY",
    "display": "¥42.50"
  }
}
```

强制语义：

- `period.timezone` 必须是 IANA 时区；`startsAt`/`endsAt` 是该统计日的 UTC 边界，满足 `startsAt < endsAt`。今日由服务端计算。
- v1 固定公式为 `total = input + output + cachedInput`。若上游还统计 reasoning 或其他 Token，必须新增明确字段并发布经双方确认的新公式，不能静默改变 `total`。
- 无用量返回字符串 `"0"`，不能返回 `null`。所有 Token 与 `requests` 均为十进制整数字符串。
- 客户端按字符串显示 Token，不转换为 IEEE-754 number，因此必须提供超过 `2^53` 的 fixture。

`balance` 是按 `state` 区分的联合类型：

```json
{ "state": "available", "value": "42.50", "unit": "CNY", "display": "¥42.50" }
```

```json
{ "state": "unavailable", "display": "暂不可用", "unit": "CNY", "reason": "settling" }
```

```json
{ "state": "unlimited", "display": "不限额" }
```

只有 `available` 必须包含 `value`；`unlimited` 表示账户没有可扣减余额上限，不能用于表达隐私隐藏。上游必须明确每个 `unit` 的小数精度、舍入规则以及余额是否允许为负；`display` 由服务端统一格式化。

### 缓存与过期

- 成功响应使用 `Cache-Control: private, max-age=30`（具体秒数可协商但必须写入 OpenAPI），禁止 `public` 和共享 CDN 缓存。
- 客户端在 max-age 内可复用缓存；手动刷新绕过本地新鲜缓存。
- 当当前时间达到 `period.endsAt`，上一统计日缓存立即失效，即使 max-age 尚未结束。
- 503、超时或离线时，客户端只可显示同一 `period` 且生成时间不超过 5 分钟的旧缓存，并明确标记 `stale`；超过 5 分钟或跨日旧值不得作为“今日”数据显示。
- 401 时无条件删除凭据和所有摘要/排行榜缓存；403 也不得回退旧缓存。401/403 均不得降级显示旧账户数据。

## 5. 独立分页排行榜

### `GET /leaderboard/today?cursor=<opaque>&limit=50`

```json
{
  "generatedAt": "2026-08-16T08:30:00Z",
  "period": {
    "timezone": "Asia/Shanghai",
    "startsAt": "2026-08-15T16:00:00Z",
    "endsAt": "2026-08-16T16:00:00Z"
  },
  "rows": [
    {
      "rank": 1,
      "userId": "usr_public_abc",
      "displayName": "J***e",
      "tokens": "985000",
      "isCurrentUser": false
    }
  ],
  "currentUserRank": 12,
  "nextCursor": "opaque-next-page-token"
}
```

排行榜与摘要独立请求、独立失败、独立缓存；排行榜慢或失败不得阻塞 Token/余额。`cursor` 是不透明游标，`limit` 支持 1 至 100，省略时默认 50。末页省略 `nextCursor`。没有个人排名时省略 `currentUserRank`，不得用 0 代替。

服务端负责聚合、排序和稳定的同分规则。`displayName` 必须脱敏，`userId` 使用排行榜专用公开 ID。用户选择隐藏时，不向其他用户返回该行；可向本人返回 `currentUserRank`。不得提供“一次取所有用户”的无分页接口。

## 6. CLI 配置所需接口

### `GET /client-profiles`

返回经过验证的客户端配置：Codex 仅接受 `openai-responses`，Claude Code 仅接受 `anthropic-messages`。每项包含固定 HTTPS `baseUrl`、真实兼容的模型 ID、显示名、推荐标志和认证类型。不能把 Chat Completions 标为 Responses，也不能在没有协议转换服务时把 Responses 模型标为 Anthropic Messages。

### 网关 Key

- `GET /gateway-keys`：只返回 ID、名称、脱敏前缀和时间，不返回 secret。
- `POST /gateway-keys`：创建 `model:invoke` 范围的设备专用 Key，明文 secret 只返回一次。
- `DELETE /gateway-keys/{id}`：按设备撤销并返回 204。

Rust 收到 secret 后直接写入 Windows Credential Manager 或 macOS Keychain，不经 Tauri IPC 返回 React。Codex 通过 `auth.command`、Claude Code 通过 `apiKeyHelper` 调用本地凭据助手。

## 7. 上游验收 fixtures

OpenAPI 3.1 附带的脱敏 fixtures 至少覆盖：

- 摘要零用量；`total`、输入或输出大于 `9007199254740991`；余额 `available`、`unavailable`、`unlimited`；未知新增响应字段。
- 排行榜空列表、单页、多页、末页、无个人排名、超大 Token、无效游标和 `limit` 边界。
- 登录成功、凭据错误、challenge；刷新成功、Refresh Token 轮换和过期。
- entitlement 为 `unlocked`、`guest-limited`、过期、套餐到期与服务端撤销；验证 Skills/MCP 各 3 的访客限制以及旧超额资料不裁剪。
- 应用重启后使用 Refresh Token 恢复；本机退出后禁止旧 Token 静默恢复；离线时 entitlement 到期后回到访客新增规则。
- 401 后凭据与缓存清理；403 禁止 stale；429 且带 `Retry-After`；503/超时下同日 5 分钟内 stale，以及超过 5 分钟和跨日拒绝 stale。
- `period` 在 `Asia/Shanghai` 的日界线，以及夏令时地区 23/25 小时统计日。

在 base URL、证书、challenge 流程、Token 生命周期、会话撤销与离线语义、entitlement 生命周期、时区与 Token 公式、余额单位精度、排行榜同分/隐私规则、Codex/Claude 实际 endpoint 和网关 Key 生命周期全部确认后，桌面端才能启用正式 HTTP transport。
