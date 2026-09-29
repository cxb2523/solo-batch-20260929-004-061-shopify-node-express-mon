import { Session } from "@shopify/shopify-api";
import Cryptr from "cryptr";
import SessionModel from "./models/SessionModel.js";

const cryption = new Cryptr(process.env.ENCRYPTION_STRING);

const MONGO_DUPLICATE_KEY = 11000;

/**
 * Rebuilds a persisted plain object back into a Shopify {@link Session},
 * restoring `expires` and `refreshTokenExpires` from strings.
 *
 * @param {string} encrypted - Encrypted JSON produced by {@link storeSession}.
 * @returns {Session} The reconstructed Shopify session.
 */
const deserializeSession = (encrypted) => {
  const sessionObj = JSON.parse(cryption.decrypt(encrypted));

  // Convert date strings back to usable dates
  if (sessionObj?.expires) {
    sessionObj.expires = new Date(sessionObj.expires);
  }
  if (sessionObj?.refreshTokenExpires) {
    sessionObj.refreshTokenExpires = new Date(sessionObj.refreshTokenExpires);
  }

  return new Session(sessionObj);
};

/**
 * Creates the MongoDB backed SessionStorage adapter used by the OAuth chain.
 *
 * The returned object matches the shape Shopify expects from a custom
 * SessionStorage (`storeSession` / `loadSession` / `deleteSession`). It takes
 * the model as an argument so tests can inject an in-memory implementation
 * without a running MongoDB server.
 *
 * Tradeoffs encoded here:
 * - Sessions upsert on `{ shop, isOnline }`, so a repeated OAuth callback for
   the same shop/access mode updates the existing row instead of inserting.
 * - A duplicate-key error (concurrent offline + online writes colliding on
   the unique compound index) is retried as an idempotent update.
 * - `expires` is part of the same awaited write, so callers can await this
 * before redirecting and never lose expiry on reinstall/reload.
 *
 * @param {typeof SessionModel} [model] - Mongoose model (or test double)
 *   backing the store. Defaults to the real `SessionModel`.
 * @returns {{
 *   storeSession: (session: Session) => Promise<boolean>,
 *   loadSession: (id: string) => Promise<Session | undefined>,
 *   deleteSession: (id: string) => Promise<boolean>,
 * }} The custom SessionStorage adapter.
 */
const createSessionStorage = (model = SessionModel) => {
  /**
   * Encrypts and idempotently upserts a session by `{ shop, isOnline }`.
   *
   * Safe to await before the post-OAuth redirect: the `expires` field is
   * written in the same operation. Retried once on a duplicate-key error to
   * absorb concurrent offline/online writes.
   *
   * @param {Session} session - The Shopify session object to persist.
   * @returns {Promise<boolean>} `true` once the write is durable.
   */
  const storeSession = async (session) => {
    const isOnline = Boolean(session.isOnline);
    const update = {
      id: session.id,
      content: cryption.encrypt(JSON.stringify(session)),
      shop: session.shop,
      isOnline,
      expires: session.expires ?? null,
    };

    try {
      await model.findOneAndUpdate({ shop: session.shop, isOnline }, update, {
        upsert: true,
      });
    } catch (error) {
      // Concurrent offline/online upserts can both miss and race the unique
      // { shop, isOnline } index; the loser performs the same update on the
      // row the winner just created.
      if (error?.code !== MONGO_DUPLICATE_KEY) {
        throw error;
      }
      await model.findOneAndUpdate({ shop: session.shop, isOnline }, update);
    }

    return true;
  };

  /**
   * Loads, decrypts and expire-checks a session by id.
   *
   * Returns `undefined` both when no row exists and when the stored
   *   `expires` is in the past, so expired sessions are unreadable immediately
   *   instead of only after MongoDB's TTL monitor sweeps the row.
   *
   * @param {string} id - The session id.
   * @returns {Promise<Session | undefined>} The Shopify session, or
   *   `undefined` when missing or expired.
   */
  const loadSession = async (id) => {
    const sessionResult = await model.findOne({ id });

    if (sessionResult === null) {
      return undefined;
    }
    if (sessionResult.content.length > 0) {
      const session = deserializeSession(sessionResult.content);

      // Application-level backstop for the TTL index: never hand back an
      // expired session even if the TTL reaper has not run yet. Prefer the
      // row's TTL field because uninstall cleanup stamps that field past
      // without rewriting the encrypted content.
      const expiry =
        sessionResult.expires instanceof Date &&
        !Number.isNaN(sessionResult.expires.getTime())
          ? sessionResult.expires
          : session.expires;
      if (expiry && expiry.getTime() <= Date.now()) {
        return undefined;
      }

      return session;
    }
    return undefined;
  };

  /**
   * Deletes a session by id.
   *
   * @param {string} id - The session id.
   * @returns {Promise<boolean>} `true` when the delete completes.
   */
  const deleteSession = async (id) => {
    await model.deleteMany({ id });
    return true;
  };

  return { storeSession, loadSession, deleteSession };
};

/**
 * Default MongoDB-backed SessionStorage adapter.
 *
 * @type {ReturnType<typeof createSessionStorage>}
 */
const sessionHandler = createSessionStorage();

export default sessionHandler;
export { createSessionStorage, deserializeSession };
