import { Router } from "express";
import oauthChain from "../../../shared/oauthChain.js";

const debugRouter = Router();

/**
 * Route handler for `GET /debug/oauth`.
 *
 * Serves the shared install-chain document that the client debug page also
 * imports directly, keeping one source of truth.
 *
 * @param {import("express").Request} _req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {void}
 */
const getOAuthChain = (_req, res) => {
  res.status(200).json(oauthChain);
};

debugRouter.get("/oauth", getOAuthChain);

export default debugRouter;
export { getOAuthChain };
