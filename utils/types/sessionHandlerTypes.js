/**
 * @typedef {Object} SessionStorage
 * @property {(session: import("@shopify/shopify-api").Session) => Promise<boolean>} storeSession
 *   Idempotently upserts a session by `shop` + `isOnline`; resolves only
 *   after `expires` is written, so callers can safely redirect afterwards.
 * @property {(id: string) => Promise<import("@shopify/shopify-api").Session | undefined>} loadSession
 *   Loads a session by id and treats expired rows as missing.
 * @property {(id: string) => Promise<boolean>} deleteSession
 *   Removes a single session by id.
 * @property {(shop: string) => Promise<boolean>} deleteSessionsForShop
 *   Stamps a shop's sessions with `expires = now` so the shared TTL index
 *   reaps them on uninstall.
 */

export {};
