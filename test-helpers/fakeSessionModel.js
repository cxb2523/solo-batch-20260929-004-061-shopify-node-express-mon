/**
 * In-memory stand-in for the Mongoose `session` model.
 *
 * Implements the same upsert/update/find surface the session adapter uses and
 * enforces the two guarantees the real MongoDB indexes provide: uniqueness
 * on `id` and on the compound `(shop, isOnline)` key. This lets the
 * acceptance tests exercise the production adapter without a database.
 */

const DUPLICATE_KEY = 11000;

/**
 * Builds a fresh in-memory model with isolated storage.
 *
 * @returns {Object} Model object matching the adapter's Mongoose surface.
 */
export const createFakeSessionModel = () => {
  /** @type {Array<Record<string, unknown>>} */
  const rows = [];

  const hasId = (id) => rows.some((row) => row.id === id);
  const hasPair = (shop, isOnline) =>
    rows.some((row) => row.shop === shop && row.isOnline === isOnline);

  return {
    rows,

    /**
     * @param {Record<string, unknown>} filter
     */
    async findOne(filter) {
      return (
        rows.find((row) =>
          Object.entries(filter).every(([key, value]) => row[key] === value)
        ) ?? null
      );
    },

    /**
     * @param {Record<string, unknown>} filter
     * @param {{ $set?: Record<string, unknown>, $setOnInsert?: Record<string, unknown> }} update
     * @param {{ upsert?: boolean }} [options]
     */
    async findOneAndUpdate(filter, update, options = {}) {
      const index = rows.findIndex((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value)
      );

      if (index >= 0) {
        rows[index] = { ...rows[index], ...(update.$set || {}) };
        return rows[index];
      }

      if (!options.upsert) {
        return null;
      }

      const inserted = {
        ...(update.$setOnInsert || {}),
        ...(update.$set || {}),
      };
      if (hasId(inserted.id) || hasPair(inserted.shop, inserted.isOnline)) {
        const error = new Error("E11000 duplicate key");
        error.code = DUPLICATE_KEY;
        throw error;
      }

      rows.push(inserted);
      return inserted;
    },

    /**
     * @param {Record<string, unknown>} filter
     * @param {{ $set?: Record<string, unknown> }} update
     */
    async updateOne(filter, update) {
      const row = rows.find((candidate) =>
        Object.entries(filter).every(([key, value]) => candidate[key] === value)
      );
      if (row) {
        Object.assign(row, update.$set || {});
      }
      return { matchedCount: row ? 1 : 0 };
    },

    /**
     * @param {Record<string, unknown>} filter
     * @param {{ $set?: Record<string, unknown> }} update
     */
    async updateMany(filter, update) {
      const matched = rows.filter((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value)
      );
      matched.forEach((row) => Object.assign(row, update.$set || {}));
      return { matchedCount: matched.length };
    },

    /**
     * @param {Record<string, unknown>} filter
     */
    async deleteOne(filter) {
      const index = rows.findIndex((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value)
      );
      if (index >= 0) {
        rows.splice(index, 1);
      }
      return { deletedCount: index >= 0 ? 1 : 0 };
    },

    /**
     * @param {Record<string, unknown>} filter
     */
    async deleteMany(filter) {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (
          Object.entries(filter).every(
            ([key, value]) => rows[index][key] === value
          )
        ) {
          rows.splice(index, 1);
        }
      }
      return { deletedCount: before - rows.length };
    },
  };
};
