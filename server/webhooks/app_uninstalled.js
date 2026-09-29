import SessionModel from "../../utils/models/SessionModel.js";
import StoreModel from "../../utils/models/StoreModel.js";

/**
 * @typedef { import("../../_developer/types/2026-07/webhooks.js").APP_UNINSTALLED } webhookTopic
 */

/**
 * Handles the `app/uninstalled` webhook.
 *
 * Marks the store inactive and expires every one of its sessions by stamping
 * `expires` to a past date. Session rows are then removed by the same TTL
 * index that handles natural token expiry, so uninstall cleanup and expiry
 * never rely on two different code paths.
 *
 * @param {string} topic - Webhook topic name.
 * @param {string} shop - The `.myshopify.com` domain that uninstalled.
 * @param {string} webhookRequestBody - Raw webhook payload.
 * @param {string} webhookId - Webhook delivery id.
 * @param {string} apiVersion - API version that delivered the webhook.
 * @returns {Promise<void>} Resolves once the store and sessions are updated.
 */
const appUninstallHandler = async (
  topic,
  shop,
  webhookRequestBody,
  webhookId,
  apiVersion
) => {
  /** @type {webhookTopic} */
  const webhookBody = JSON.parse(webhookRequestBody);
  await StoreModel.findOneAndUpdate({ shop }, { isActive: false });
  // Reuse the shared `expires` TTL index instead of a separate delete path.
  await SessionModel.updateMany({ shop }, { $set: { expires: new Date(0) } });
};

export default appUninstallHandler;
