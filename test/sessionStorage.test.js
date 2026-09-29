import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Session } from "@shopify/shopify-api";

process.env.ENCRYPTION_STRING = process.env.ENCRYPTION_STRING || "test-secret";

const { createSessionStorage } = await import("../utils/sessionHandler.js");
const { createFakeSessionModel } =
  await import("../test-helpers/fakeSessionModel.js");

const SHOP = "demo-store.myshopify.com";

/**
 * Builds a minimal valid session for the storage tests.
 *
 * @param {Object} overrides - Session fields to override.
 * @returns {Session} The constructed session.
 */
const buildSession = (overrides = {}) =>
  new Session({
    id: "offline_demo-store",
    shop: SHOP,
    state: "state-123",
    isOnline: false,
    scope: "read_products",
    accessToken: "token-1",
    ...overrides,
  });

describe("custom SessionStorage", () => {
  it("keeps a single row when the OAuth callback is repeated", async () => {
    const model = createFakeSessionModel();
    const storage = createSessionStorage(model);

    await storage.storeSession(buildSession({ accessToken: "token-1" }));
    await storage.storeSession(
      buildSession({ accessToken: "token-2", state: "state-456" })
    );
    await storage.storeSession(buildSession({ accessToken: "token-3" }));

    const rowsForShop = model.rows.filter((row) => row.shop === SHOP);
    assert.equal(
      rowsForShop.length,
      1,
      "repeat callbacks must upsert instead of inserting"
    );

    const loaded = await storage.loadSession("offline_demo-store");
    assert.ok(loaded);
    assert.equal(loaded.accessToken, "token-3");
  });

  it("keeps one row per shop + isOnline pair under concurrent writes", async () => {
    const model = createFakeSessionModel();
    const storage = createSessionStorage(model);

    // Interleave the two writes so they race the unique (shop, isOnline)
    // index exactly like offline and online callbacks can in production.
    const offline = buildSession({
      id: "offline_demo-store",
      isOnline: false,
    });
    const online = buildSession({
      id: "online_demo-store_user-1",
      isOnline: true,
      expires: new Date(Date.now() + 60_000),
      accessToken: "online-token",
    });

    const first = storage.storeSession(offline);
    const second = storage.storeSession(online);
    // A retried duplicate callback for online while both are in flight.
    const duplicate = storage.storeSession(
      new Session({
        ...online.toObject(),
        accessToken: "online-token-2",
      })
    );

    await Promise.all([first, second, duplicate]);

    const offlineRows = model.rows.filter(
      (row) => row.shop === SHOP && row.isOnline === false
    );
    const onlineRows = model.rows.filter(
      (row) => row.shop === SHOP && row.isOnline === true
    );

    assert.equal(offlineRows.length, 1);
    assert.equal(onlineRows.length, 1);
    assert.equal(model.rows.length, 2);
  });

  it("does not read a session after it expires", async () => {
    const model = createFakeSessionModel();
    const storage = createSessionStorage(model);

    const session = buildSession({
      id: "online_demo-store_user-1",
      isOnline: true,
      expires: new Date(Date.now() + 60_000),
    });

    await storage.storeSession(session);

    const beforeExpiry = await storage.loadSession(session.id);
    assert.ok(beforeExpiry, "session is readable before expiry");

    // Rewind the row's TTL clock to simulate Mongo's TTL monitor not having
    // reaped the document yet; the app-layer check must still hide it.
    model.rows[0].expires = new Date(Date.now() - 1_000);

    const afterExpiry = await storage.loadSession(session.id);
    assert.equal(
      afterExpiry,
      undefined,
      "expired session must read as missing"
    );
  });

  it("schedules uninstall cleanup through the same TTL expires field", async () => {
    const model = createFakeSessionModel();
    const storage = createSessionStorage(model);

    await storage.storeSession(
      buildSession({
        id: "online_demo-store_user-1",
        isOnline: true,
        expires: new Date(Date.now() + 60_000),
      })
    );
    await storage.storeSession(buildSession({ id: "offline_demo-store" }));

    const now = Date.now();
    await storage.deleteSessionsForShop(SHOP);

    assert.equal(
      model.rows.length,
      2,
      "TTL cleanup stamps, does not hard delete"
    );
    model.rows.forEach((row) => {
      assert.ok(
        new Date(row.expires).getTime() <= now + 1_000,
        "uninstalled rows are expired via the shared TTL field"
      );
    });

    const loaded = await storage.loadSession("offline_demo-store");
    assert.equal(loaded, undefined, "uninstalled sessions read as missing");
  });
});
