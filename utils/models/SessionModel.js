// Session store model to preserve sessions across restarts.
import mongoose from "mongoose";

/**
 * Fallback retention window used by the single shared TTL index.
 *
 * Expiring online sessions are removed at their real `expires` time, while
 * non-expiring offline sessions and sessions orphaned by an
 * `app/uninstalled` webhook land on this same ceiling. Keeping one constant
 * means expiry cleanup and uninstall cleanup can never drift apart.
 *
 * @type {number}
 */
export const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const sessionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  content: {
    type: String,
    required: true,
  },
  shop: {
    type: String,
    required: true,
  },
  isOnline: {
    type: Boolean,
    required: true,
  },
  expires: {
    type: Date,
    // Every session row carries a value, so this one TTL index is the only
    // cleanup path. `expireAfterSeconds: 0` makes Mongo delete the document
    // exactly at `expires`; expiry and uninstall share the same index.
    required: true,
    expires: 0,
  },
});

/**
 * Idempotency guard for repeat OAuth callbacks: one row per
 * `(shop, isOnline)` pair. A repeated callback resolves to the same row via
 * an upsert, and concurrent offline/online writes that race the upsert are
 * rejected with a duplicate-key error by this unique index instead of
 * creating a second record.
 */
sessionSchema.index({ shop: 1, isOnline: 1 }, { unique: true });

const SessionModel = mongoose.model("session", sessionSchema);

/**
 * Builds the indexes declared on the session collection.
 *
 * @returns {Promise<Array<string>>} The names of the built indexes.
 */
export const syncSessionIndexes = () => {
  return SessionModel.createIndexes();
};

export default SessionModel;
