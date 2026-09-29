# Shopify Node.js x Express.js x React.js Boilerplate

An embedded app starter template to get up and ready with Shopify app development with JavaScript. This is heavily influenced by the choices Shopify Engineering team made in building their [starter template](https://github.com/Shopify/shopify-app-template-node) to ensure smooth transition between templates.

I've included [notes](/docs/NOTES.md) on this repo which goes over the repo on why certain choices were made.

I also did make a video going over the entire repo.

[![Creating a Shopify app from scratch](https://img.youtube.com/vi/iV_3ENCraaM/0.jpg)](https://www.youtube.com/watch?v=iV_3ENCraaM)

## Supporting repositories

- [`@kinngh/shopify-nextjs-prisma-app`](https://github.com/kinngh/shopify-nextjs-prisma-app): A Shopify app boilerplate built with Next.js and Prisma ORM, with deployments available on Vercel.
- [`@kinngh/shopify-polaris-playground`](https://github.com/kinngh/shopify-polaris-playground): Build your app's UI using Polaris, without an internet connection.

## Tech Stack

- React.js
  - `raviger` for routing.
- Express.js
- MongoDB
- Vite
- Ngrok

## Why I made this

The Shopify CLI generates an amazing starter app but it still needs some more boilerplate code and customizations so I can jump on to building apps with a simple clone. This includes:

- MongoDB based session and database management.
- Monetization (recurring subscriptions) ready to go.
- Webhooks isolated and setup.
- React routing taken care of (I miss Next.js mostly because of routing and under the hood improvements).
- Misc boilerplate code and templates to quickly setup inApp subscriptions, routes, webhooks and more.

## Notes

### Setup

- Refer to [SETUP](/docs/SETUP.md)
- Migrations are available in [DOCS](/docs/migrations/)
- Setting up [Polaris WebComponents](/docs/POLARIS_WC.md)

### Misc

- Storing data is kept to a minimal to allow building custom models for flexibility.
  - Session persistence is also kept to a minimal and based on the Redis example provided by Shopify, but feel free to modify as required.

## 调用链：Shopify OAuth 安装链路

经典 OAuth 授权（`/auth` → Shopify → `/auth/callback`）与 managed
installation（token exchange）并存。本节描述经典授权链路；机器可读的唯一
数据源是 [`shared/oauthChain.js`](shared/oauthChain.js)，由
`GET /debug/oauth` 返回，并被 [`client/pages/debug/OAuth.jsx`](client/pages/debug/OAuth.jsx)
直接渲染，因此接口与页面不会漂移。

### 链路步骤

| #   | 路由                                 | 源文件                               | 函数                      | 说明                                                    |
| --- | ------------------------------------ | ------------------------------------ | ------------------------- | ------------------------------------------------------- |
| 1   | `GET /auth`                          | `server/routes/auth.js`              | `beginAuth`               | 生成 state(nonce)、写签名 cookie，302 到 Shopify 授权页 |
| 2   | `GET /auth/callback`                 | `server/routes/auth.js`              | `handleAuthCallback`      | 校验 state/nonce 与 HMAC，用授权码换取 Session          |
| 3   | `GET /auth/callback`                 | `utils/sessionHandler.js`            | `storeSession`            | redirect 前 `await` 的幂等 upsert，含 `expires`         |
| 4   | `GET /auth/callback`                 | `server/routes/auth.js`              | `redirectAfterCallback`   | session 落库后再跳回嵌入式 App                          |
| 5   | Mongo 索引                           | `utils/models/SessionModel.js`       | `configureSessionIndexes` | `{shop,isOnline}` 唯一索引 + `expires` TTL              |
| 6   | 中间件读取                           | `utils/sessionHandler.js`            | `loadSession`             | 解密、还原日期、应用层过期判定                          |
| 7   | `POST /api/webhooks/app_uninstalled` | `server/webhooks/app_uninstalled.js` | `appUninstallHandler`     | 卸载时把 `expires` 置为过去时间，交给同一 TTL 清理      |

### state / nonce 校验分支

state 本身即 nonce（库不在 cookie 之外另存 nonce）。回调时库
（`@shopify/shopify-api` 的 `auth.callback`）执行两条校验：签名 cookie 中的
state 与查询参数 `state` 用 `safeCompare` 比对；查询串 HMAC 用 API secret
校验。分支：

- 缺少/无法验签 `shopify_app_state` cookie：抛 `CookieNotFound`，重新走 `/auth`。
- `state` 不匹配或 HMAC 无效：抛 `InvalidOAuthError`，同样重新发起授权，不写任何 session。
- 两者均通过：换取 token 并进入 `storeSession`。

### 三处取舍（已落进代码）

1. **`expires` 必须在 redirect 前写完**：`handleAuthCallback` 先
   `await sessionHandler.storeSession(session)` 再 `redirectAfterCallback`，
   否则刷新/重装可能在写入前跳走，导致“安装后无 session”重装循环。
2. **重复回调按 `shop + isOnline` 幂等 upsert**：`storeSession` 以
   `{ shop, isOnline }` 为 upsert 键，重复回调更新同一行，不新增记录。
3. **并发写入靠唯一索引，清理共用 TTL**：offline/online token 并发 upsert
   由 `{ shop, isOnline }` 唯一索引兜底（冲突方按 11000 重试同一更新）；
   `expires` 上的 TTL 索引同时服务自然过期与卸载清理——卸载只把行的
   `expires` 置为过去时间，不再维护单独的删除路径。

### 文档与代码差异（以代码为准）

- [`docs/migrations/oauth-to-managed-installation.md`](docs/migrations/oauth-to-managed-installation.md)
  声称 `auth` 中间件与路由已“完全移除”。**差异**：`server/routes/auth.js`
  重新挂载了 `/auth` 与 `/auth/callback`，与 token exchange 并存；以代码为准。
- 旧模板常描述“单独存储的 nonce”。**差异**：本实现里 OAuth `state` 就是
  nonce，仅存在于签名且限定 path 的 `shopify_app_state` cookie 中，回调时
  以 `safeCompare` 比对。

### 可观测性

- `GET /debug/oauth`：返回链路 JSON（步骤、state/nonce 分支、取舍、文档差异）。
- 前端在 Debug 首页进入 **OAuth Chain**（路由 `/debug/oauth`），渲染可点步骤、
  源文件与函数名，并可一键回源接口比对是否同步。
