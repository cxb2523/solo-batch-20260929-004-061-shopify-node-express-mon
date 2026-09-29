import StoreModel from "../../utils/models/StoreModel.js";
import sessionHandler from "../../utils/sessionHandler.js";

/**
 * @typedef { import("../../_developer/types/2026-07/webhooks.js").APP_UNINSTALLED } webhookTopic
 */

/**
 * Handles the `app/uninstalled` webhook.
 *
 * Marks the store inactive and schedules the shop's sessions for removal by
 * stamping `expires = now`, reusing the same TTL index that cleans up
 * naturally-expiring sessions instead of a separate delete path.
 *
 * @param {string} topic - Webhook topic name.
 * @param {string} shop - Domain of the uninstalling shop.
 * @param {string} webhookRequestBody - Raw JSON webhook payload.
 * @param {string} webhookId - Shopify webhook delivery id.
 * @param {string} apiVersion - API version of the delivery.
 * @returns {Promise<void>} Resolves once cleanup writes are durable.
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
  // Reuse the shared TTL cleanup: stamp expires = now so the same TTL index
  // that reaps expired tokens also reaps sessions on uninstall.
  await sessionHandler.deleteSessionsForShop(shop);
};

export default appUninstallHandler;
