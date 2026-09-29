import { Session } from "@shopify/shopify-api";
import Cryptr from "cryptr";
import SessionModel, { SESSION_RETENTION_MS } from "./models/SessionModel.js";

const cryption = new Cryptr(process.env.ENCRYPTION_STRING);

/**
 * Duplicate-key error code returned by Mongo when the unique
 * `(shop, isOnline)` index loses a race.
 *
 * @type {number}
 */
const MONGO_DUPLICATE_KEY = 11000;

/**
 * Computes the absolute deletion time a session row must carry.
 *
 * Expiring sessions are deleted at their own `expires` instant. Sessions
 * without an access-token expiry (offline tokens) receive the shared
 * retention ceiling instead, so that one TTL index governs every row.
 *
 * @param {Session} session - The session being persisted.
 * @returns {Date} The instant Mongo's TTL monitor may delete the row.
 */
const ttlExpiresFor = (session) =>
  session.expires
    ? new Date(session.expires)
    : new Date(Date.now() + SESSION_RETENTION_MS);

/**
 * Builds the storage functions for a session collection. The model is
 * injectable so tests can run the real adapter logic against an in-memory
 * model instead of a live MongoDB instance.
 *
 * @param {import("mongoose").Model} model - Mongoose model exposing
 *   `findOneAndUpdate`, `findOne`, `updateOne`, `deleteMany` and
 *   `deleteOne`.
 * @returns {import("./types/sessionHandlerTypes.js").SessionStorage} The
 *   custom SessionStorage adapter used across the OAuth install flow.
 */
const createSessionStorage = (model) => {
  /**
   * Persists a session idempotently.
   *
   * Rows are keyed on `shop` + `isOnline`, so a repeat OAuth callback for the
   * same shop and access mode updates the existing document instead of
   * inserting a second one. Offline and online callbacks can run
   * concurrently; if both attempts hit the same `(shop, isOnline)` pair at
   * once, the unique index rejects one write with error code 11000 and that
   * write is retried as a plain update. The returned promise resolves only
   * after the document (including `expires`) is fully written, which is why
   * callers must `await` it before issuing the post-callback redirect.
   *
   * @param {Session} session - The Shopify session object to persist.
   * @returns {Promise<boolean>} `true` once the write is durable.
   */
  const storeSession = async (session) => {
    const serialized = session.toObject();
    const fields = {
      content: cryption.encrypt(JSON.stringify(serialized)),
      shop: session.shop,
      isOnline: Boolean(session.isOnline),
      expires: ttlExpiresFor(session),
    };

    try {
      await model.findOneAndUpdate(
        { shop: session.shop, isOnline: Boolean(session.isOnline) },
        { $set: fields, $setOnInsert: { id: session.id } },
        { upsert: true }
      );
    } catch (error) {
      // Unique-index race: the other write won the insert, finish as update.
      if (error?.code !== MONGO_DUPLICATE_KEY) {
        throw error;
      }
      await model.updateOne(
        { shop: session.shop, isOnline: Boolean(session.isOnline) },
        { $set: fields }
      );
    }

    return true;
  };

  /**
   * Loads a session by its Shopify session id.
   *
   * Expired rows are treated as absent even before the Mongo TTL monitor has
   * physically removed them, so callers never read a session whose access
   * token is past its `expires` instant.
   *
   * @param {string} id - The Shopify session id.
   * @returns {Promise<Session | undefined>} The decrypted session, or
   *   `undefined` when missing or expired.
   */
  const loadSession = async (id) => {
    const sessionResult = await model.findOne({ id });

    if (sessionResult === null) {
      return undefined;
    }
    if (sessionResult.content.length > 0) {
      const sessionObj = JSON.parse(cryption.decrypt(sessionResult.content));

      //Convert date strings to usable dates
      if (sessionObj?.expires) {
        sessionObj.expires = new Date(sessionObj.expires);
      }
      if (sessionObj?.refreshTokenExpires) {
        sessionObj.refreshTokenExpires = new Date(
          sessionObj.refreshTokenExpires
        );
      }

      // App-layer TTL: an expired session reads as missing regardless of how
      // long Mongo takes to reap the document via its TTL index. The row
      // field is authoritative because uninstall cleanup stamps it without
      // rewriting the encrypted content.
      if (
        sessionResult.expires &&
        new Date(sessionResult.expires).getTime() <= Date.now()
      ) {
        return undefined;
      }

      return new Session(sessionObj);
    }
    return undefined;
  };

  /**
   * Deletes a single session by id.
   *
   * @param {string} id - The Shopify session id to remove.
   * @returns {Promise<boolean>} `true` when the call completes.
   */
  const deleteSession = async (id) => {
    await model.deleteOne({ id });
    return true;
  };

  /**
   * Expires every session for a shop through the shared TTL index.
   *
   * Used by the `app/uninstalled` webhook: rather than a separate delete
   * path, rows are stamped with `expires = now`, which reuses the exact same
   * TTL cleanup mechanism as naturally-expiring online tokens.
   *
   * @param {string} shop - The shop domain being uninstalled.
   * @returns {Promise<boolean>} `true` once the rows are scheduled for TTL.
   */
  const deleteSessionsForShop = async (shop) => {
    await model.updateMany({ shop }, { $set: { expires: new Date() } });
    return true;
  };

  return { storeSession, loadSession, deleteSession, deleteSessionsForShop };
};

/** Production Mongo-backed SessionStorage adapter used by the OAuth flow. */
const sessionHandler = createSessionStorage(SessionModel);

export default sessionHandler;
export { createSessionStorage };
