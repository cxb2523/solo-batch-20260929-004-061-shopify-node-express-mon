import { Router } from "express";
import sessionHandler from "../../../utils/sessionHandler.js";
import shopify from "../../../utils/shopify.js";

const authRouter = Router();

/**
 * Guard that stops processing when the response has already been sent.
 *
 * On the Node runtime `shopify.auth.begin` applies the 302 status, state
 * cookie and `Location` header and ends the response itself; the handler must
 * not touch the response afterwards.
 *
 * @param {import("express").Response} res - Express response object.
 * @returns {boolean} `true` when a response has already been sent.
 */
const alreadySent = (res) => res.writableEnded || res.headersSent;

/**
 * Starts the OAuth dance for a single access mode.
 *
 * Delegates state/nonce generation and the authorize redirect to
 * `shopify.auth.begin`.
 *
 * @param {import("express").Request} req - Express request object carrying
 *   `shop` and the signed `host`.
 * @param {import("express").Response} res - Express response object.
 * @param {boolean} isOnline - `true` for an online (per-user) token,
 *   `false` for the shop-level offline token installed first.
 * @returns {Promise<void>} Resolves once the redirect response is sent.
 */
const beginOAuth = async (req, res, isOnline) => {
  await shopify.auth.begin({
    shop: req.query.shop,
    callbackPath: "/auth/callback",
    isOnline,
    rawRequest: req,
    rawResponse: res,
  });
};

/**
 * Route handler for `GET /auth`.
 *
 * Installs the offline token first so background jobs have a shop-scoped
 * session; `?online=true` restarts the dance for the per-user online token
 * after the offline callback completes.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>} Resolves once the response is sent.
 */
const startInstall = async (req, res) => {
  let shop = null;
  try {
    shop = shopify.utils.sanitizeShop(req.query.shop);
  } catch (error) {
    shop = null;
  }

  if (!shop) {
    return res.status(400).send("Invalid shop parameter");
  }

  try {
    await beginOAuth(req, res, req.query.online === "true");
    if (alreadySent(res)) {
      return;
    }
  } catch (error) {
    console.error("---> Failed to begin OAuth", error);
    if (!res.headersSent) {
      res.status(500).send("Failed to begin OAuth");
    }
  }
};

/**
 * Maps a failed OAuth callback to an HTTP status.
 *
 * Missing state cookies and nonce/HMAC failures are caller errors; bots get
 * the library's 410 Gone.
 *
 * @param {Error} error - Error thrown by `shopify.auth.callback`.
 * @returns {number} HTTP status code.
 */
const statusForOAuthError = (error) => {
  const errorName = error?.constructor?.name || error?.name;
  if (errorName === "BotActivityDetected") {
    return 410;
  }
  if (errorName === "CookieNotFound" || errorName === "InvalidOAuth") {
    return 403;
  }
  return 500;
};

/**
 * Writes a JSON error for a failed OAuth callback.
 *
 * @param {import("express").Response} res - Express response object.
 * @param {Error} error - Error thrown while validating the callback.
 * @returns {void}
 */
const respondWithOAuthError = (res, error) => {
  res.status(statusForOAuthError(error)).json({
    error: error.message,
    name: error.constructor?.name || error.name,
  });
};

/**
 * Finishes a validated callback: persists the session and redirects.
 *
 * `storeSession` is awaited before any redirect so the encrypted payload,
 * `isOnline` flag and `expires` instant are durable. An offline session
 * redirects to the online leg of the dance; an online session enters the
 * embedded app.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @param {import("@shopify/shopify-api").Session} session - Session returned
 *   by `shopify.auth.callback`.
 * @param {Record<string, string>} headers - Set-cookie/state headers from
 *   the library callback to forward to the browser.
 * @returns {Promise<void>} Resolves after the redirect response is sent.
 */
const completeCallback = async (req, res, session, headers) => {
  await sessionHandler.storeSession(session);

  Object.entries(headers || {}).forEach(([header, value]) => {
    res.setHeader(header, value);
  });

  if (session.isOnline) {
    res.redirect(`/?shop=${session.shop}`);
  } else {
    res.redirect(`/auth?shop=${session.shop}&online=true`);
  }
};

/**
 * Route handler for `GET /auth/callback`.
 *
 * Validates the signed state cookie plus nonce and the HMAC, exchanges the
 * authorization code for a session, and hands off to `completeCallback`.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>} Resolves once the response is sent.
 */
const handleAuthCallback = async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    await completeCallback(req, res, callback.session, callback.headers);
  } catch (error) {
    console.error("---> Failed to complete OAuth", error);
    if (!res.headersSent) {
      respondWithOAuthError(res, error);
    }
  }
};

authRouter.get("/", startInstall);
authRouter.get("/callback", handleAuthCallback);

export default authRouter;
export { startInstall, handleAuthCallback };
