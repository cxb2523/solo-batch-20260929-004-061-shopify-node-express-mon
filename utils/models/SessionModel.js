// Session store model to preserve sessions across restarts.
import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  shop: {
    type: String,
    required: true,
  },
  // false -> offline access token, true -> online access token. Part of the
  // idempotent upsert key so repeated callbacks never duplicate a row.
  isOnline: {
    type: Boolean,
    required: true,
    default: false,
  },
  // TTL anchor. Expiring tokens persist their expiry; non-expiring offline
  // tokens leave this unset so Mongo's TTL index keeps them indefinitely.
  // Uninstall stamps this to a past date to reuse the same cleanup path.
  expires: {
    type: Date,
    default: null,
  },
});

/**
 * Declares the indexes that make the OAuth storage tradeoffs safe:
 *
 * - A unique compound index on `{ shop, isOnline }` guarantees one session row
 *   per shop per access mode, absorbing the race when the offline and online
 *   tokens are written concurrently (the adapter retries duplicate-key
 *   errors).
 * - A TTL index on `expires` with `expireAfterSeconds: 0` removes rows at the
 *   timestamp stored on the document. Natural token expiry and app-uninstall
 *   cleanup both flow through this single index.
 *
 * @returns {void}
 */
const configureSessionIndexes = () => {
  sessionSchema.index({ shop: 1, isOnline: 1 }, { unique: true });
  sessionSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });
};

configureSessionIndexes();

const SessionModel = mongoose.model("session", sessionSchema);

export default SessionModel;
export { configureSessionIndexes, sessionSchema };
