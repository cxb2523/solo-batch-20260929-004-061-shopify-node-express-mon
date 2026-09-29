/**
 * Minimal in-memory stand-in for the Mongoose `SessionModel` used by the
 * session storage tests. It implements only the methods the adapter calls and
 * emulates the unique `{ shop, isOnline }` index so tests run without MongoDB.
 */

const findKey = (rows, filter) =>
  rows.findIndex((row) =>
    Object.entries(filter).every(([key, value]) => row[key] === value)
  );

/**
 * Creates an in-memory session collection.
 *
 * @param {object} [options] - Options.
 * @param {Array<{ shop: string, isOnline: boolean }>} [options.duplicateOnce] -
 *   Filter pairs that should throw a duplicate-key error on their first
 *   upsert, emulating the MongoDB unique-index race.
 * @returns {{
 *   rows: Array<object>,
 *   findOne: (filter: object) => Promise<object | null>,
 *   findOneAndUpdate: (filter: object, update: object, options?: object) =>
 *     Promise<object>,
 *   deleteMany: (filter: object) => Promise<{ deletedCount: number }>,
 *   updateMany: (filter: object, update: object) => Promise<{ modifiedCount: number }>,
 * }} The fake model.
 */
const createMemoryModel = ({ duplicateOnce = [] } = {}) => {
  const model = {
    rows: [],

    async findOne(filter) {
      const index = findKey(model.rows, filter);
      return index === -1 ? null : model.rows[index];
    },

    async findOneAndUpdate(filter, update, options = {}) {
      const index = findKey(model.rows, filter);

      // Emulate the unique { shop, isOnline } index when two callers race on
      // an insert: the configured first attempt duplicates the winner's row.
      if (options.upsert && index === -1) {
        const dupIndex = duplicateOnce.findIndex(
          (pair) =>
            pair.shop === filter.shop && pair.isOnline === filter.isOnline
        );
        if (dupIndex !== -1) {
          duplicateOnce.splice(dupIndex, 1);
          const error = new Error("E11000 duplicate key");
          error.code = 11000;
          throw error;
        }
      }

      if (index === -1) {
        model.rows.push({ ...filter, ...update });
      } else {
        model.rows[index] = { ...model.rows[index], ...update };
      }
      return model.rows[index];
    },

    deleteMany(filter) {
      const before = model.rows.length;
      model.rows = model.rows.filter(
        (row) => !Object.entries(filter).every(([k, v]) => row[k] === v)
      );
      return Promise.resolve({ deletedCount: before - model.rows.length });
    },

    updateMany(filter, update) {
      let modifiedCount = 0;
      model.rows = model.rows.map((row) => {
        if (Object.entries(filter).every(([k, v]) => row[k] === v)) {
          modifiedCount += 1;
          return { ...row, ...update.$set };
        }
        return row;
      });
      return Promise.resolve({ modifiedCount });
    },
  };

  return model;
};

export default createMemoryModel;
