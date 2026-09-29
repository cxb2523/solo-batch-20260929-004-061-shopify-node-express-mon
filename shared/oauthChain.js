/**
 * Single source of truth for the Shopify OAuth install chain.
 *
 * This module is isomorphic and deliberately contains no Node.js or browser
 * only APIs so it can be imported by both the Express debug endpoint
 * (`server/routes/debug.js`) and the React debug page
 * (`client/pages/debug/OAuth.jsx`). Keeping the chain in one place means the
 * JSON returned by `GET /debug/oauth` and the steps rendered on the page can
 * never drift apart.
 *
 * Every step points at a named function in a repository file. The functions
 * named here are the ones covered by JSDoc and by the `npm test` chain checks.
 *
 * @module shared/oauthChain
 */

/**
 * Ordered steps of the `/auth` -> `/auth/callback` -> session persistence
 * chain. `order` drives rendering and tests, `phase` groups steps visually.
 *
 * @type {Array<{
 *   order: number,
 *   id: string,
 *   route: string,
 *   method: string,
 *   phase: "redirect" | "callback" | "storage" | "read" | "cleanup",
 *   file: string,
 *   function: string,
 *   title: string,
 *   description: string,
 * }>}
 */
const oauthSteps = [
  {
    order: 1,
    id: "auth-redirect",
    route: "/auth",
    method: "GET",
    phase: "redirect",
    file: "server/routes/auth.js",
    function: "beginAuth",
    title: "Start OAuth and redirect to Shopify",
    description:
      "Sanitizes the shop, generates a state nonce via shopify.auth.begin(), " +
      "sets the signed state cookie scoped to the callback path and responds " +
      "with a 302 to the Shopify authorize screen.",
  },
  {
    order: 2,
    id: "auth-callback",
    route: "/auth/callback",
    method: "GET",
    phase: "callback",
    file: "server/routes/auth.js",
    function: "handleAuthCallback",
    title: "Validate state/nonce and exchange code",
    description:
      "shopify.auth.callback() verifies the signed state cookie (the nonce) " +
      "against the state query param and validates the HMAC before exchanging " +
      "the authorization code for an access token and a Session.",
  },
  {
    order: 3,
    id: "store-session",
    route: "/auth/callback",
    method: "GET",
    phase: "storage",
    file: "utils/sessionHandler.js",
    function: "storeSession",
    title: "Idempotently upsert the encrypted session",
    description:
      "Awaited BEFORE the post-install redirect so the expires field is never " +
      "lost on reload or reinstall. The upsert key is shop + isOnline, so a " +
      "repeated callback updates the same row instead of inserting a new one. " +
      "A duplicate-key retry covers the offline/online concurrent-write race.",
  },
  {
    order: 4,
    id: "redirect-after-callback",
    route: "/auth/callback",
    method: "GET",
    phase: "callback",
    file: "server/routes/auth.js",
    function: "redirectAfterCallback",
    title: "Redirect into the embedded app",
    description:
      "Only reached after storeSession has resolved; bounces the merchant back " +
      "into the embedded app at the host provided by Shopify.",
  },
  {
    order: 5,
    id: "session-indexes",
    route: "mongodb:session",
    method: "INDEX",
    phase: "storage",
    file: "utils/models/SessionModel.js",
    function: "configureSessionIndexes",
    title: "Unique (shop, isOnline) and shared TTL indexes",
    description:
      "A unique compound index on { shop, isOnline } makes concurrent offline " +
      "and online writes collapse onto one row per access mode. A TTL index on " +
      "the expires field is the single cleanup mechanism shared by natural " +
      "expiry and app uninstall.",
  },
  {
    order: 6,
    id: "load-session",
    route: "middleware",
    method: "CALL",
    phase: "read",
    file: "utils/sessionHandler.js",
    function: "loadSession",
    title: "Load, decrypt and expire a session",
    description:
      "Reads by session id, decrypts the content, rebuilds Date fields and " +
      "returns undefined when the row is missing or already past expires, so " +
      "expired sessions are unreadable even before the TTL reaper has run.",
  },
  {
    order: 7,
    id: "app-uninstalled",
    route: "/api/webhooks/app_uninstalled",
    method: "POST",
    phase: "cleanup",
    file: "server/webhooks/app_uninstalled.js",
    function: "appUninstallHandler",
    title: "Uninstall clears sessions through the same TTL",
    description:
      "Marks the store inactive and sets every session's expires field to a " +
      "past date; the shared TTL index then removes the rows, so expiry and " +
      "uninstall never maintain two different cleanup paths.",
  },
];

/**
 * state/nonce validation branches exercised by the callback. The library
 * (`@shopify/shopify-api` auth.oauth.callback) performs the actual checks; the
 * router's `respondToAuthError` decides what the merchant sees for each branch.
 *
 * @type {Array<{
 *   id: string,
 *   check: string,
 *   result: "failure" | "success",
 *   behavior: string,
 * }>}
 */
const stateNonceBranches = [
  {
    id: "missing-state-cookie",
    check: "Signed shopify_app_state cookie is absent or fails verification",
    result: "failure",
    behavior:
      "Library throws CookieNotFound; respondToAuthError restarts /auth " +
      "instead of exchanging any code.",
  },
  {
    id: "state-mismatch",
    check: "state query param does not safeCompare-equal the cookie nonce",
    result: "failure",
    behavior:
      "validQuery fails and the library throws InvalidOAuthError; the " +
      "request is bounced back through /auth to mint a fresh nonce.",
  },
  {
    id: "bad-hmac",
    check: "Callback query string HMAC is not valid for the API secret",
    result: "failure",
    behavior:
      "validQuery fails alongside the state check; same InvalidOAuthError " +
      "branch, no session is stored.",
  },
  {
    id: "valid",
    check: "Cookie nonce matches state and HMAC verifies",
    result: "success",
    behavior:
      "Authorization code is exchanged for a Session and the chain " +
      "continues to storeSession.",
  },
];

/**
 * Deliberate engineering tradeoffs encoded in the chain.
 *
 * @type {Array<{ id: string, title: string, detail: string }>}
 */
const tradeoffs = [
  {
    id: "expires-before-redirect",
    title: "expires is persisted before the redirect",
    detail:
      "handleAuthCallback awaits storeSession before redirectAfterCallback. " +
      "If the response redirected first, a reload or reinstall could race " +
      "the write and land on an app with no session.",
  },
  {
    id: "idempotent-shop-isonline",
    title: "Repeated callbacks upsert by shop + isOnline",
    detail:
      "storeSession filters on { shop, isOnline } rather than session id, so " +
      "replaying /auth/callback updates one row instead of accumulating " +
      "duplicates.",
  },
  {
    id: "unique-index-race-ttl",
    title: "Unique index races offline/online; one TTL cleans all",
    detail:
      "The unique { shop, isOnline } index plus a duplicate-key retry makes " +
      "concurrent offline and online token writes safe, and both natural " +
      "expiry and uninstall cleanup go through the same expires TTL index.",
  },
];

/**
 * Places where the written docs intentionally defer to the code.
 *
 * @type {Array<{ topic: string, doc: string, code: string }>}
 */
const docCodeDiffs = [
  {
    topic: "Auth route availability",
    doc:
      "docs/migrations/oauth-to-managed-installation.md states the /auth " +
      "middleware and its routes were completely removed.",
    code:
      "server/routes/auth.js mounts /auth and /auth/callback again; the " +
      "code is authoritative and supports the classic grant alongside token " +
      "exchange.",
  },
  {
    topic: "Nonce storage",
    doc: "Older Shopify templates describe a separately stored nonce.",
    code:
      "The OAuth state value IS the nonce; it lives only in the signed, " +
      "path-scoped shopify_app_state cookie and is compared with safeCompare.",
  },
];

const oauthChain = {
  version: 1,
  endpoint: "/debug/oauth",
  entrypoints: [
    { method: "GET", path: "/auth", function: "beginAuth" },
    { method: "GET", path: "/auth/callback", function: "handleAuthCallback" },
  ],
  steps: oauthSteps,
  stateNonceBranches,
  tradeoffs,
  docCodeDiffs,
};

export default oauthChain;
export { oauthSteps, stateNonceBranches, tradeoffs, docCodeDiffs };
