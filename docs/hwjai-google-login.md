# new-api：Google 登录安全配置

本文说明如何通过 new-api 的自定义 OAuth 管理界面配置 Google 登录。Google 预设只填充公开协议参数，不含任何真实凭据，保存时默认禁用，需管理员确认配置后显式启用。本文不代表已经完成生产环境配置、部署或真实 Google 登录验证。

## 1. 确认公开站点地址

在安全的管理员界面确认 `ServerAddress` 是用户实际访问的公开站点 origin，包括协议、主机和必要的端口，例如 `https://login.example.com`。不要包含路径、查询参数或片段，建议不带末尾斜杠。

Google OAuth 客户端、new-api 的 `ServerAddress` 和用户发起登录时的公开 origin 必须完全一致。`http` 与 `https`、不同子域名及不同端口不可互换。生产环境应使用 HTTPS；若经过反向代理，也应使用外部 HTTPS 地址，而不是内部监听地址。

回调地址为：

```text
https://login.example.com/oauth/google
```

请将示例 origin 替换为自己的公开 origin。slug 为 `google` 时，路径必须是 `/oauth/google`，不是 `/api/oauth/google`；大小写和末尾斜杠也要与实际回调精确匹配。如果修改 slug，必须相应更新 Google 控制台中的回调地址。

## 2. 在 Google 控制台创建 OAuth 客户端

1. 在 Google Cloud 的 Google Auth Platform 中选择自己的项目，配置应用品牌、联系信息、受众和 OAuth 同意屏幕。
2. 若应用处于测试阶段，将允许登录的账号添加到测试用户。是否需要发布、验证或组织审批，取决于自己的应用类型和 Google 要求。
3. 创建 **Web application（Web 应用）类型的 OAuth 2.0 客户端**。
4. 在 **Authorized redirect URIs（授权重定向 URI）** 中填写公开站点的完整 `/oauth/google` 回调地址。若配置 **Authorized JavaScript origins（授权 JavaScript 来源）**，只填写相同的 origin；它不能代替重定向 URI。
5. 保存客户端 ID 和客户端密钥，仅通过安全渠道交给有权限的站点管理员。

OAuth 客户端 ID/密钥不是 Gemini API key。Gemini API key 不能用于 Google 登录。

**不要将真实客户端密钥发送到聊天、工单、截图、源码、文档或日志中。** 只能在可信 HTTPS 站点的安全管理员界面输入或更新凭据。不要用共享演示凭据或从其他提供商复制密钥。

## 3. 使用 Google 预设

在 new-api 的系统设置 → 身份验证 → 自定义 OAuth 中新建提供商，选择 **Google**。无需填写 Base URL 或联网发现，即会填入：

| 设置 | Google 预设 |
| --- | --- |
| 名称 / slug / 图标 | `Google` / `google` / `google` |
| Well-Known URL | `https://accounts.google.com/.well-known/openid-configuration` |
| 授权端点 | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token 端点 | `https://oauth2.googleapis.com/token` |
| UserInfo 端点 | `https://openidconnect.googleapis.com/v1/userinfo` |
| Scope | `openid email profile` |
| 用户 ID 字段 | `sub` |
| 用户名字段 | 留空，使用 new-api 既有的用户名回退逻辑 |
| 显示名称字段 | `name` |
| 邮箱字段 | `email` |
| 认证方式 | `auth_style: 1`（凭据放在请求参数中） |
| 默认状态 | 禁用 |

默认接入策略要求 UserInfo 中的 `email_verified` 为布尔值 `true`：

```json
{
  "logic": "and",
  "conditions": [
    { "field": "email_verified", "op": "eq", "value": true }
  ]
}
```

保持此策略，避免把未经验证的邮箱当作已验证身份。身份标识使用 Google 的 `sub`，不要改为邮箱或显示名称。该策略不限制 Google Workspace 域；若需要域限制，应由管理员另外设计和审核接入策略。

在安全管理员界面输入专属 **Client ID** 和 **Client Secret**。创建时必须填写密钥；编辑时将密钥留空表示保留已有密钥。切换预设不会替换已经输入的凭据，因此切换到另一提供商后，应由管理员自己确认并修改为对应的凭据。

先以禁用状态保存并检查配置。准备好后，管理员再显式开启“启用”并保存。只有来自既有状态接口的已启用提供商会显示登录按钮；仅选择预设或保存禁用配置不会创建可用登录入口。

## 4. 人工验证清单

使用独立测试账号和测试环境检查，成功之后再决定是否向用户开放：

- 公开站点 origin、`ServerAddress` 和 Google 授权回调精确匹配。
- 提供商使用 slug `google`，端点与上表一致，凭据属于该 OAuth Web 客户端。
- 保存禁用配置后没有 Google 登录按钮；管理员启用后，状态接口更新才出现入口。
- 点击 Google 登录应经过现有 OAuth state 流程；不要绕过 state 校验，不要手工把 token 或授权码贴到聊天。
- 登录应从 Google 跳回同一站点的 `/oauth/google`，且可完成账号登录。
- 在已登录账号中测试绑定时，继续使用原有账号绑定流程和 state 校验；先使用无重要数据的测试账号。
- 编辑时留空 Client Secret 并保存，应保持原有密钥；更换密钥只能由管理员通过安全界面执行。
- 若出现 `redirect_uri_mismatch`，核对完整回调；若出现受众/访问限制，检查 Google 测试用户、组织策略和应用发布状态。排查时只分享已脱敏的错误信息，不分享凭据、授权码、token、数据库内容或日志原文。

以上是待管理员执行的验证步骤，不是已经通过的运行结果。
