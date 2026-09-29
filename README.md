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

## OAuth Install Call Chain

The classic OAuth install flow (`GET /auth` and `GET /auth/callback`) is wired alongside the newer managed-installation token exchange, and it is observable end-to-end through `GET /debug/oauth` (JSON) and the `/debug/oauth` page in the embedded app. The page and the endpoint both read the same file, [`shared/oauthChain.js`](shared/oauthChain.js), so they cannot drift.

### Request flow

1. `GET /auth?shop=<shop>.myshopify.com` is handled by `startInstall` in [`server/routes/auth/index.js`](server/routes/auth/index.js). Offline access is requested first; `?online=true` starts the online (per-user) leg.
2. `beginOAuth` calls `shopify.auth.begin`, which generates the state/nonce, signs it into a `shopify_app_state` cookie scoped to the callback path (60s lifetime) and 302-redirects to Shopify's `/admin/oauth/authorize`.
3. Shopify redirects back to `GET /auth/callback`, handled by `handleAuthCallback`. `shopify.auth.callback` verifies the signed state cookie, compares the nonce with `safeCompare` and validates the `hmac`, then exchanges the authorization code for a session.
4. `completeCallback` **awaits `storeSession` before redirecting**. The persisted row always includes `isOnline` and the absolute `expires` instant, so a reinstall can never resume a half-written session. Offline sessions redirect to `/auth?online=true`; online sessions redirect into the app at `/?shop=...`.
5. Sessions are read through `loadSession` and removed on `app/uninstalled` by `appUninstallHandler`.

### state / nonce validation branches

All failure branches are implemented in `server/routes/auth/index.js` and listed in `GET /debug/oauth`:

- **Missing state cookie** (`CookieNotFound`, HTTP 403): no signed `shopify_app_state` cookie reaches the callback — it expired after 60 seconds, the callback was replayed, or the state cookie was scoped to a different path. No session is stored.
- **nonce mismatch** (`InvalidOAuth`, HTTP 403): `query.state` does not `safeCompare`-equal the nonce held in the signed cookie, i.e. a forged or replayed callback.
- **bad `hmac`** (`InvalidOAuth`, HTTP 403): `validateHmac` rejects the callback query signature.
- **bot traffic** (`BotActivityDetected`, HTTP 410): the callback user agent is classified as a bot.
- **success**: state cookie verifies, nonce matches and HMAC is valid; the code is exchanged and the session is persisted before the redirect.

### Storage tradeoffs (code is the source of truth)

These three choices live in [`utils/sessionHandler.js`](utils/sessionHandler.js) and [`utils/models/SessionModel.js`](utils/models/SessionModel.js):

1. **Write `expires` before the redirect.** `storeSession` is awaited inside `completeCallback`; the response only redirects after the upsert (content, `isOnline`, `expires`) resolves.
2. **Repeat callbacks are idempotent.** Rows are upserted on the unique `(shop, isOnline)` key, so hitting `/auth/callback` twice for the same shop and access mode updates one row instead of inserting another.
3. **Concurrency and cleanup share indexes.** The unique `(shop, isOnline)` index is the backstop when offline and online token writes race: the losing upsert receives Mongo error `11000` and is retried as an update. A single TTL index on `expires` (`expireAfterSeconds: 0`) covers both natural token expiry and uninstall — `appUninstallHandler` stamps the shop's rows with `expires = now` via `deleteSessionsForShop` instead of taking a separate delete path. `loadSession` also treats an expired row as missing, so reads fail closed even before Mongo's TTL monitor physically removes the document.

### Differences from the original template docs

The current repo's primary auth path is managed installation via token exchange (see [`docs/migrations/oauth-to-managed-installation.md`](docs/migrations/oauth-to-managed-installation.md)); that migration document states the `auth` middleware and routes "are completely gone". This call chain and the code reintroduce `/auth` and `/auth/callback` as an explicit, observable classic-OAuth route mounted by `createServer` in [`server/index.js`](server/index.js). Where this README and that older document disagree, **the code is authoritative**; the discrepancy is this section.
