import { Router } from "express";
import { CookieNotFound, InvalidOAuthError } from "@shopify/shopify-api";
import sessionHandler from "../../utils/sessionHandler.js";
import shopify from "../../utils/shopify.js";

const authRouter = Router();

/**
 * Path Shopify redirects back to after the merchant approves install. Kept
 * in one constant so the signed state cookie scope and the route never drift.
 */
const CALLBACK_PATH = "/auth/callback";

/**
 * `GET /auth?shop=...` - starts the classic OAuth grant.
 *
 * Sanitizes the shop, then delegates to `shopify.auth.begin`, which mints the
 * state nonce, sets the signed `shopify_app_state` cookie scoped to the
 * callback path and responds with a 302 to Shopify's authorize screen. On the
 * Node adapter the 302 is written to `res` directly.
 *
 * @param {import("express").Request} req - Express request; `shop` must be in
 *   the query string.
 * @param {import("express").Response} res - Express response receiving the
 *   redirect.
 * @returns {Promise<void>} Resolves once the redirect has been sent.
 */
const beginAuth = async (req, res) => {
  await shopify.auth.begin({
    shop: req.query.shop,
    callbackPath: CALLBACK_PATH,
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });
};

/**
 * Sends the merchant back into the embedded app after a successful callback.
 *
 * Only called after `storeSession` has resolved, guaranteeing the session -
 * including its `expires` field - is durable before the browser leaves the
 * callback. Falls back to the app root when the `host` param is missing.
 *
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Resolves once the redirect has been sent.
 */
const redirectAfterCallback = async (req, res) => {
  const host = req.query.host;
  if (host) {
    const redirectUrl = shopify.auth.buildEmbeddedAppUrl(host);
    res.redirect(redirectUrl);
  } else {
    res.redirect(`/?shop=${encodeURIComponent(req.query.shop)}`);
  }
};

/**
 * Maps the library's state/nonce validation failures to a safe response.
 *
 * - {@link CookieNotFound}: the signed state cookie is missing or unverifiable.
 * - {@link InvalidOAuthError}: HMAC failed or the `state` query param does not
 *   match the cookie nonce.
 *
 * Both branches restart the grant at `/auth` so a fresh nonce is minted and no
 * session is ever stored for an unverified callback.
 *
 * @param {import("express").Response} res - Express response.
 * @param {unknown} error - Error thrown by `shopify.auth.callback`.
 * @returns {void} Sends a 302 (state/nonce failure) or a 500 (other error).
 */
const respondToAuthError = (res, error) => {
  if (error instanceof CookieNotFound || error instanceof InvalidOAuthError) {
    console.error("--> OAuth state/nonce validation failed:", error.message);
    res.redirect("/auth");
    return;
  }

  console.error("--> OAuth callback failed:", error);
  res.status(500).send({ error: "OAuth callback failed" });
};

/**
 * `GET /auth/callback` - completes the classic OAuth grant.
 *
 * `shopify.auth.callback` verifies the signed state cookie against the
 * `state` query param (the nonce) and validates the HMAC, then exchanges the
 * authorization code for a Session. The session is awaited through
 * `storeSession` BEFORE any redirect so a reload/reinstall cannot lose it, and
 * only then is the merchant bounced into the app.
 *
 * @param {import("express").Request} req - Express callback request.
 * @param {import("express").Response} res - Express callback response.
 * @returns {Promise<void>} Resolves once the response is sent.
 */
const handleAuthCallback = async (req, res) => {
  try {
    const { session } = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    // CRITICAL: await before redirecting so expires/content are durable for a
    // reload or reinstall. Idempotent on { shop, isOnline }.
    await sessionHandler.storeSession(session);

    await redirectAfterCallback(req, res);
  } catch (error) {
    respondToAuthError(res, error);
  }
};

authRouter.get("/", beginAuth);
authRouter.get("/callback", handleAuthCallback);

export default authRouter;
export { beginAuth, handleAuthCallback, redirectAfterCallback };
