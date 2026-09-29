/**
 * Single source of truth for the OAuth install-chain observability data.
 *
 * Imported by the `GET /debug/oauth` route (`server/routes/debug/index.js`)
 * and by the client page (`client/pages/debug/OAuth.jsx`) so the API
 * response and the rendered steps can never drift apart. Every entry with a
 * `file` + `fn` pair names a function that exists in that file and carries a
 * JSDoc block; entries describing library internals set `library: true`.
 *
 * @typedef {Object} OAuthChainEntry
 * @property {string} id - Stable identifier for the step.
 * @property {string} title - Human-readable step name.
 * @property {string} file - Repo-relative source file for the step.
 * @property {string} fn - Function name implementing the step.
 * @property {string} [method] - HTTP method when the step is a route.
 * @property {string} [path] - HTTP path when the step is a route.
 * @property {string} detail - What the step does.
 * @property {boolean} [library] - `true` for code living in a dependency.
 *
 * @typedef {Object} OAuthChainBranch
 * @property {string} id - Stable identifier for the branch.
 * @property {"state" | "nonce" | "hmac" | "bot" | "success"} kind - What is
 *   being branched on.
 * @property {string} condition - When this branch is taken.
 * @property {string} outcome - What the chain does next.
 *
 * @typedef {Object} OAuthChain
 * @property {string} endpoint - Path serving this document.
 * @property {OAuthChainEntry[]} steps - Ordered install-chain steps.
 * @property {OAuthChainBranch[]} branches - Validation branches.
 * @property {{ key: string, file: string, purpose: string }[]} indexes -
 *   MongoDB indexes that back the storage guarantees.
 * @property {{ ttl: string, detail: string }} ttl - Shared TTL policy.
 */

/** @type {OAuthChain} */
const oauthChain = {
  endpoint: "/debug/oauth",
  steps: [
    {
      id: "mount-auth-router",
      title: "Mount the OAuth router at /auth",
      file: "server/index.js",
      fn: "createServer",
      detail:
        "Registers the auth router so GET /auth and GET /auth/callback are reachable before any authenticated route.",
    },
    {
      id: "auth-start",
      title: "Begin install",
      method: "GET",
      path: "/auth",
      file: "server/routes/auth/index.js",
      fn: "startInstall",
      detail:
        "Sanitizes the shop query param and starts OAuth offline first, or online when ?online=true.",
    },
    {
      id: "auth-begin",
      title: "Redirect to Shopify authorize",
      file: "server/routes/auth/index.js",
      fn: "beginOAuth",
      detail:
        "Calls shopify.auth.begin, which generates the state/nonce, signs it into a state cookie and returns a 302 to /admin/oauth/authorize.",
    },
    {
      id: "library-state-cookie",
      title: "State/nonce cookie is signed",
      file: "node_modules/@shopify/shopify-api/lib/auth/oauth/oauth.ts",
      fn: "begin",
      library: true,
      detail:
        "Library writes a signed shopify_app_state cookie scoped to the callback path with a 60s lifetime.",
    },
    {
      id: "auth-callback",
      title: "Handle OAuth callback",
      method: "GET",
      path: "/auth/callback",
      file: "server/routes/auth/index.js",
      fn: "handleAuthCallback",
      detail:
        "Verifies the signed state cookie, nonce and HMAC, then exchanges the code for a session.",
    },
    {
      id: "library-callback-validate",
      title: "Verify state, nonce and HMAC",
      file: "node_modules/@shopify/shopify-api/lib/auth/oauth/oauth.ts",
      fn: "callback",
      library: true,
      detail:
        "getAndVerify rejects a missing/tampered state cookie (CookieNotFound); validQuery requires validateHmac and safeCompare(state, cookie nonce) (InvalidOAuth).",
    },
    {
      id: "auth-error",
      title: "Reject an invalid callback",
      file: "server/routes/auth/index.js",
      fn: "respondWithOAuthError",
      detail:
        "Maps missing state, nonce/state mismatch, bad HMAC and bot traffic to a 4xx response instead of storing a session.",
    },
    {
      id: "callback-complete",
      title: "Persist session before redirect",
      file: "server/routes/auth/index.js",
      fn: "completeCallback",
      detail:
        "Awaits storeSession so expires is durable, then redirects: offline sessions bounce to online OAuth, online sessions enter the app.",
    },
    {
      id: "session-store",
      title: "Idempotent session upsert",
      file: "utils/sessionHandler.js",
      fn: "storeSession",
      detail:
        "Upserts on shop + isOnline so repeat callbacks never add a row; a duplicate-key loss from concurrent offline/online writes is retried as an update.",
    },
    {
      id: "session-load",
      title: "Read session, hiding expired rows",
      file: "utils/sessionHandler.js",
      fn: "loadSession",
      detail:
        "Decrypts the session and returns undefined once expires is in the past, even before Mongo's TTL monitor deletes the row.",
    },
    {
      id: "session-indexes",
      title: "Ensure unique and TTL indexes",
      file: "utils/models/SessionModel.js",
      fn: "syncSessionIndexes",
      detail:
        "Builds the unique (shop, isOnline) index that guards callback races and the TTL index on expires.",
    },
    {
      id: "uninstall-cleanup",
      title: "Uninstall reuses the TTL",
      file: "server/webhooks/app_uninstalled.js",
      fn: "appUninstallHandler",
      detail:
        "On app/uninstalled the shop's rows are stamped expires = now via deleteSessionsForShop, so the same TTL index reaps them.",
    },
    {
      id: "debug-endpoint",
      title: "Serve this chain document",
      method: "GET",
      path: "/debug/oauth",
      file: "server/routes/debug/index.js",
      fn: "getOAuthChain",
      detail: "Returns the shared chain JSON used by the client debug page.",
    },
  ],
  branches: [
    {
      id: "state-cookie-missing",
      kind: "state",
      condition:
        "No signed shopify_app_state cookie on /auth/callback (expired after 60s, replay or cross-shop callback).",
      outcome:
        "shopify.auth.callback throws CookieNotFound and respondWithOAuthError returns 403; no session is stored.",
    },
    {
      id: "nonce-mismatch",
      kind: "nonce",
      condition:
        "query.state does not safeCompare-equal the nonce stored in the signed state cookie.",
      outcome:
        "validQuery fails, shopify.auth.callback throws InvalidOAuth and respondWithOAuthError returns 403.",
    },
    {
      id: "hmac-invalid",
      kind: "hmac",
      condition: "validateHmac rejects the callback query signature.",
      outcome:
        "validQuery fails with InvalidOAuth and respondWithOAuthError returns 403.",
    },
    {
      id: "bot-detected",
      kind: "bot",
      condition: "The callback user agent is classified as a bot.",
      outcome:
        "BotActivityDetected is thrown and respondWithOAuthError returns 410.",
    },
    {
      id: "callback-valid",
      kind: "success",
      condition:
        "State cookie verifies, nonce matches and HMAC is valid, so the code is exchanged for a session.",
      outcome:
        "completeCallback awaits storeSession (expires included) then redirects to online OAuth or the embedded app.",
    },
  ],
  indexes: [
    {
      key: "id_1",
      file: "utils/models/SessionModel.js",
      purpose: "Unique Shopify session id lookup for loadSession.",
    },
    {
      key: "shop_1_isOnline_1",
      file: "utils/models/SessionModel.js",
      purpose:
        "Unique compound key: repeat callbacks upsert one row per shop + access mode and concurrent writes are forced through one winner.",
    },
    {
      key: "expires_1 (expireAfterSeconds: 0)",
      file: "utils/models/SessionModel.js",
      purpose:
        "Single TTL index deleting each row at its expires instant; natural token expiry and uninstall cleanup share it.",
    },
  ],
  ttl: {
    ttl: "expireAfterSeconds: 0 on expires",
    detail:
      "Online sessions use their token expires; non-expiring offline sessions and uninstalled shops are stamped with the shared SESSION_RETENTION_MS / now() ceiling, so one TTL index covers expiry and uninstall cleanup.",
  },
};

export default oauthChain;
