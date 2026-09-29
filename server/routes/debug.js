import { Router } from "express";
import oauthChain from "../../shared/oauthChain.js";

const debugRouter = Router();

/**
 * `GET /debug/oauth` - returns the OAuth install chain as JSON.
 *
 * The payload is served directly from `shared/oauthChain.js`, the same module
 * the React debug page imports, so the endpoint and the page render from one
 * source of truth and cannot drift.
 *
 * @param {import("express").Request} _req - Express request (unused).
 * @param {import("express").Response} res - Express response.
 * @returns {void} Responds with the chain JSON.
 */
const getOauthChain = (_req, res) => {
  res.status(200).json(oauthChain);
};

debugRouter.get("/oauth", getOauthChain);

export default debugRouter;
export { getOauthChain };
