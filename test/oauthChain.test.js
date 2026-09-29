import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.ENCRYPTION_STRING = process.env.ENCRYPTION_STRING || "test-secret";
process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test-key";
process.env.SHOPIFY_API_SECRET =
  process.env.SHOPIFY_API_SECRET || "test-secret";
process.env.SHOPIFY_API_SCOPES =
  process.env.SHOPIFY_API_SCOPES || "read_products";
process.env.SHOPIFY_APP_URL =
  process.env.SHOPIFY_APP_URL || "https://example.ngrok.io";
process.env.SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const oauthChainModule = await import(
  pathToFileURL(path.join(repoRoot, "shared", "oauthChain.js")).href
);
const oauthChain = oauthChainModule.default;

/**
 * Resolves a repo-relative source file for assertions.
 *
 * @param {string} relativePath - Path relative to the repo root.
 * @returns {string} File contents.
 */
const readRepoFile = (relativePath) =>
  readFileSync(path.join(repoRoot, relativePath), "utf-8");

test("GET /debug/oauth serves the shared chain JSON", async () => {
  const { createServer } = await import(
    pathToFileURL(path.join(repoRoot, "server", "index.js")).href
  );
  const { app: expressApp } = await createServer(repoRoot);

  const server = expressApp.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/debug/oauth`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, oauthChain);
    assert.ok(Array.isArray(body.steps) && body.steps.length >= 10);
    assert.ok(
      body.steps.some(
        (step) => step.path === "/auth" && step.fn === "startInstall"
      )
    );
    assert.ok(
      body.steps.some(
        (step) =>
          step.path === "/auth/callback" && step.fn === "handleAuthCallback"
      )
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("every chain step names a function that exists in its file with JSDoc", () => {
  const fileCache = new Map();

  oauthChain.steps.forEach((step) => {
    if (step.library) {
      return;
    }

    assert.ok(
      fileCache.has(step.file) ||
        (() => {
          fileCache.set(step.file, readRepoFile(step.file));
          return true;
        })(),
      `${step.file} must exist`
    );

    const source = fileCache.get(step.file);

    const declarationPattern = new RegExp(
      `(?:const|let|var|function)\\s+${step.fn}\\s*(?:=|\\()`,
      "m"
    );
    assert.ok(
      declarationPattern.test(source),
      `${step.fn} not found in ${step.file}`
    );

    // The declaration must be immediately preceded by a JSDoc block.
    const escapedName = step.fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const jsdocPattern = new RegExp(
      `/\\*\\*[\\s\\S]*?\\*/\\s*(?:export\\s+)?(?:const|let|var|function)\\s+${escapedName}\\b`,
      "m"
    );
    assert.ok(
      jsdocPattern.test(source),
      `${step.fn} in ${step.file} is missing a JSDoc block`
    );
  });
});

test("auth router exposes /auth and /auth/callback handlers", () => {
  const routerSource = readRepoFile(
    path.join("server", "routes", "auth", "index.js")
  );

  assert.match(routerSource, /authRouter\.get\("\/",\s*startInstall\)/);
  assert.match(
    routerSource,
    /authRouter\.get\("\/callback",\s*handleAuthCallback\)/
  );

  const mountSource = readRepoFile(path.join("server", "index.js"));
  assert.match(mountSource, /app\.use\("\/auth",\s*authRouter\)/);
});

test("GET /auth starts OAuth with a signed state cookie and 302", async () => {
  const { createServer } = await import(
    pathToFileURL(path.join(repoRoot, "server", "index.js")).href
  );
  const { app } = await createServer(repoRoot);
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(
      `http://127.0.0.1:${port}/auth?shop=demo-store.myshopify.com`,
      {
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      }
    );

    assert.equal(response.status, 302);
    const location = response.headers.get("location") || "";
    assert.match(
      location,
      /^https:\/\/demo-store\.myshopify\.com\/admin\/oauth\/authorize/
    );
    assert.match(location, /state=/);
    const cookies = response.headers.get("set-cookie") || "";
    assert.match(cookies, /shopify_app_state=/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /auth rejects a malformed shop without touching OAuth", async () => {
  const { createServer } = await import(
    pathToFileURL(path.join(repoRoot, "server", "index.js")).href
  );
  const { app } = await createServer(repoRoot);
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(
      `http://127.0.0.1:${port}/auth?shop=not-a-shop`,
      {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 Chrome/120 Safari/537.36" },
      }
    );
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /auth/callback without a state cookie is rejected as 403", async () => {
  const { createServer } = await import(
    pathToFileURL(path.join(repoRoot, "server", "index.js")).href
  );
  const { app } = await createServer(repoRoot);
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(
      `http://127.0.0.1:${port}/auth/callback?shop=demo-store.myshopify.com&state=abc&code=xyz&hmac=00`,
      {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 Chrome/120 Safari/537.36" },
      }
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.name, "CookieNotFound");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("SessionModel declares the unique shop+isOnline index and one TTL index", () => {
  const modelSource = readRepoFile(
    path.join("utils", "models", "SessionModel.js")
  );

  assert.match(
    modelSource,
    /sessionSchema\.index\(\{\s*shop:\s*1,\s*isOnline:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\)/
  );
  assert.match(modelSource, /expires:\s*0/);
});

test("uninstall cleanup reuses the shared TTL path", () => {
  const webhookSource = readRepoFile(
    path.join("server", "webhooks", "app_uninstalled.js")
  );
  assert.match(webhookSource, /deleteSessionsForShop/);
  assert.doesNotMatch(webhookSource, /SessionModel\.deleteMany/);
});
