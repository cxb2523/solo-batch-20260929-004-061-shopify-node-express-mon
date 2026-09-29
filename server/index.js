import "@shopify/shopify-api/adapters/node";
import cors from "cors";
import "dotenv/config";
import Express from "express";
import fs from "fs";
import mongoose from "mongoose";
import path, { resolve } from "path";
import { createServer as createViteServer } from "vite";
import sessionHandler from "../utils/sessionHandler.js";
import setupCheck from "../utils/setupCheck.js";
import shopify from "../utils/shopify.js";
import {
  customerDataRequest,
  customerRedact,
  shopRedact,
} from "./controllers/gdpr.js";
import eventHandler from "./events/_index.js";
import csp from "./middleware/csp.js";
import isInitialLoad from "./middleware/isInitialLoad.js";
import verifyCheckout from "./middleware/verifyCheckout.js";
import verifyHmac from "./middleware/verifyHmac.js";
import verifyProxy from "./middleware/verifyProxy.js";
import verifyRequest from "./middleware/verifyRequest.js";
import authRouter from "./routes/auth/index.js";
import debugRouter from "./routes/debug/index.js";
import proxyRouter from "./routes/app_proxy/index.js";
import checkoutRoutes from "./routes/checkout/index.js";
import userRoutes from "./routes/index.js";
import webhookHandler from "./webhooks/_index.js";
import { syncSessionIndexes } from "../utils/models/SessionModel.js";
import { fileURLToPath } from "url";

setupCheck(); // Run a check to ensure everything is setup properly

const PORT = parseInt(process.env.PORT, 10) || 8081;
const isDev = process.env.NODE_ENV === "dev";

// MongoDB Connection
const mongoUrl =
  process.env.MONGO_URL || "mongodb://127.0.0.1:27017/shopify-express-app";

/**
 * Connects to MongoDB and ensures the session collection's unique and TTL
 * indexes exist before serving traffic.
 *
 * @returns {Promise<typeof mongoose>} The connected Mongoose instance.
 */
const connectDatabase = async () => {
  await mongoose.connect(mongoUrl);
  await syncSessionIndexes();
  return mongoose;
};

/**
 * Builds the Express application with the OAuth install router, debug
 * observability router, webhooks and the Vite/static SPA fallback.
 *
 * @param {string} [root] - Project root used to locate `dist/client`.
 * @returns {Promise<{ app: Express.Express }>} The configured application.
 */
const createServer = async (root = process.cwd()) => {
  const app = Express();
  app.disable("x-powered-by");

  // Incoming webhook requests
  app.post(
    "/api/webhooks/*webhookTopic",
    Express.text({ type: "*/*" }),
    webhookHandler
  );
  app.post(
    "/api/webhooks/*eventTopic",
    Express.text({ type: "*/*" }),
    eventHandler
  );

  app.use(Express.json());

  // Classic OAuth install flow and its observability endpoint. Mounted before
  // the SPA fallbacks so /auth, /auth/callback and /debug/oauth always reach
  // their routers.
  app.use("/auth", authRouter);
  app.use("/debug", debugRouter);

  app.post("/api/graphql", verifyRequest, async (req, res) => {
    try {
      const sessionId = await shopify.session.getCurrentId({
        isOnline: true,
        rawRequest: req,
        rawResponse: res,
      });
      const session = await sessionHandler.loadSession(sessionId);
      const response = await shopify.clients.graphqlProxy({
        session,
        rawBody: req.body,
      });
      res.status(200).send(response.body);
    } catch (e) {
      console.error(`---> An error occured at GraphQL Proxy`, e);
      res.status(403).send(e);
    }
  });

  app.use(csp);
  app.use(isInitialLoad);
  //Routes to make server calls
  app.use("/api/apps", verifyRequest, userRoutes); //Verify user route requests
  app.use("/api/proxy_route", verifyProxy, proxyRouter); //MARK:- App Proxy routes
  app.use(
    "/api/checkout",
    cors({
      origin: "https://extensions.shopifycdn.com",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      optionsSuccessStatus: 200,
    }),
    verifyCheckout,
    checkoutRoutes
  );

  app.post("/api/gdpr/:topic", verifyHmac, async (req, res) => {
    const { body } = req;
    const { topic } = req.params;
    const shop = req.body.shop_domain;

    console.warn(`--> GDPR request for ${shop} / ${topic} recieved.`);

    let response;
    switch (topic) {
      case "customers_data_request":
        response = await customerDataRequest(topic, shop, body);
        break;
      case "customers_redact":
        response = await customerRedact(topic, shop, body);
        break;
      case "shop_redact":
        response = await shopRedact(topic, shop, body);
        break;
      default:
        console.error(
          "--> Congratulations on breaking the GDPR route! Here's the topic that broke it: ",
          topic
        );
        response = "broken";
        break;
    }

    if (response.success) {
      res.status(200).send();
    } else {
      res.status(403).send("An error occured");
    }
  });

  if (isDev) {
    const vite = await createViteServer({
      root: path.resolve(process.cwd(), "client"),
      server: {
        middlewareMode: true,
        ws: {
          server: app.listen(PORT, () => {
            console.log(`Dev server running on localhost:${PORT}`);
          }),
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use("*splat", async (req, res) => {
      const url = req.originalUrl;
      let template = fs.readFileSync(
        path.resolve(process.cwd(), "client", "index.html"),
        "utf-8"
      );
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(template);
    });
  } else {
    const compression = await import("compression").then(
      ({ default: fn }) => fn
    );
    const serveStatic = await import("serve-static").then(
      ({ default: fn }) => fn
    );

    app.use(compression());
    app.use(serveStatic(resolve("dist/client")));
    app.use("/*splat", (req, res, next) => {
      res
        .status(200)
        .set("Content-Type", "text/html")
        .send(fs.readFileSync(`${root}/dist/client/index.html`));
    });
  }

  return { app };
};

/**
 * Boots the HTTP server after the database connection is ready.
 *
 * @returns {Promise<void>} Resolves once the server is listening (prod) or
 *   Vite middleware mode is running (dev).
 */
const startServer = async () => {
  await connectDatabase();

  if (isDev) {
    await createServer();
  } else {
    const { app } = await createServer();
    app.listen(PORT, () => {
      console.log(`--> Running on ${PORT}`);
    });
  }
};

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer().catch((error) => {
    console.error("---> Failed to start server", error);
    process.exit(1);
  });
}

export { createServer, connectDatabase };
