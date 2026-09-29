import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./setup.js";
import { createSessionStorage } from "../utils/sessionHandler.js";
import createMemoryModel from "./memorySessionModel.js";

const SHOP = "test-shop.myshopify.com";

/**
 * Builds a plain session-shaped object; the adapter only serializes/reads the
 * fields it stores, so a plain object suffices for storage semantics.
 */
const fakeSession = ({ isOnline, id, expires }) => ({
  id,
  shop: SHOP,
  state: "state-nonce",
  scope: "read_products",
  accessToken: "token-value",
  isOnline,
  expires,
  toJSON() {
    return { ...this };
  },
});

describe("custom Mongo SessionStorage", () => {
  it("keeps a single row when the OAuth callback is repeated", async () => {
    const model = createMemoryModel();
    const storage = createSessionStorage(model);

    const first = fakeSession({
      isOnline: true,
      id: "online-id",
      expires: new Date(Date.now() + 60_000),
    });
    const repeat = fakeSession({
      isOnline: true,
      id: "online-id-rotated",
      expires: new Date(Date.now() + 120_000),
    });

    assert.equal(await storage.storeSession(first), true);
    assert.equal(await storage.storeSession(repeat), true);

    assert.equal(model.rows.length, 1, "repeated callback must not add a row");
    assert.deepEqual(
      model.rows.map((row) => [row.shop, row.isOnline]),
      [[SHOP, true]]
    );

    // The upsert refreshed the latest values on the existing row.
    assert.equal(model.rows[0].id, "online-id-rotated");
  });

  it("upserts offline and online sessions and survives the unique-index race", async () => {
    // The first online upsert loses the race and gets E11000; the adapter
    // must retry and converge on one row per access mode.
    const model = createMemoryModel({
      duplicateOnce: [{ shop: SHOP, isOnline: true }],
    });
    const storage = createSessionStorage(model);

    await Promise.all([
      storage.storeSession(
        fakeSession({
          isOnline: false,
          id: "offline-id",
          expires: null,
        })
      ),
      storage.storeSession(
        fakeSession({
          isOnline: true,
          id: "online-id",
          expires: new Date(Date.now() + 60_000),
        })
      ),
    ]);

    assert.equal(model.rows.length, 2, "one row per access mode");
    assert.deepEqual(model.rows.map((row) => row.isOnline).sort(), [
      false,
      true,
    ]);
  });

  it("cannot read a session after its expires timestamp", async () => {
    const model = createMemoryModel();
    const storage = createSessionStorage(model);

    await storage.storeSession(
      fakeSession({
        isOnline: true,
        id: "expiring-id",
        expires: new Date(Date.now() - 1_000),
      })
    );

    const loaded = await storage.loadSession("expiring-id");
    assert.equal(
      loaded,
      undefined,
      "expired session must be unreadable even before TTL reaping"
    );

    // A future session still loads.
    await storage.storeSession(
      fakeSession({
        isOnline: false,
        id: "alive-id",
        expires: new Date(Date.now() + 60_000),
      })
    );
    assert.ok(await storage.loadSession("alive-id"));

    // An unknown id also resolves to undefined.
    assert.equal(await storage.loadSession("missing"), undefined);
  });

  it("uninstall cleanup shares the TTL anchor (expires stamped in the past)", async () => {
    const model = createMemoryModel();
    const storage = createSessionStorage(model);

    await storage.storeSession(
      fakeSession({
        isOnline: true,
        id: "online-id",
        expires: new Date(Date.now() + 60_000),
      })
    );
    assert.ok(
      await storage.loadSession("online-id"),
      "session loads pre-uninstall"
    );

    const { modifiedCount } = await model.updateMany(
      { shop: SHOP },
      { $set: { expires: new Date(0) } }
    );
    assert.equal(modifiedCount, 1);
    assert.equal(
      model.rows[0].expires.getTime(),
      new Date(0).getTime(),
      "uninstall routes cleanup through the same expires TTL field"
    );
    assert.equal(await storage.loadSession("online-id"), undefined);
  });
});
