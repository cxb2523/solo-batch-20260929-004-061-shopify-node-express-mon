import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import oauthChain from "../shared/oauthChain.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Checks that a named function in a source file is immediately preceded by a
 * JSDoc block comment (only whitespace and a blank line allowed between the
 * closing comment marker and the declaration).
 *
 * @param {string} source - File contents.
 * @param {string} fnName - Function name to locate.
 * @returns {{ hit: boolean, jsdoc: boolean }} Result flags.
 */
const findFunctionWithJsdoc = (source, fnName) => {
  // A JSDoc block directly above the declaration, allowing only whitespace /
  // a single blank line between `*/` and the function definition.
  const jsdocBefore = new RegExp(
    `/\\*\\*[\\s\\S]*?\\*/\\s*(?:\\n[ \\t]*)?(?:const|function)\\s+${fnName}\\s*(?:=|\\()`
  );

  const jsdocMatch = source.match(jsdocBefore);

  return {
    hit: new RegExp(`(?:const|function)\\s+${fnName}\\s*(?:=|\\()`).test(
      source
    ),
    jsdoc: jsdocMatch !== null,
  };
};

describe("GET /debug/oauth chain integrity", () => {
  it("serves the same module the client page imports", async () => {
    const debugRoute = await readFile(
      path.join(repoRoot, "server", "routes", "debug.js"),
      "utf-8"
    );
    const clientPage = await readFile(
      path.join(repoRoot, "client", "pages", "debug", "OAuth.jsx"),
      "utf-8"
    );

    assert.match(debugRoute, /shared\/oauthChain\.js/);
    assert.match(debugRoute, /debugRouter\.get\("\/oauth"/);
    assert.match(clientPage, /shared\/oauthChain\.js/);
    assert.match(clientPage, /\/debug\/oauth/);
  });

  it("exposes ordered steps with unique ids", () => {
    assert.ok(oauthChain.steps.length >= 5);
    const orders = oauthChain.steps.map((step) => step.order);
    assert.deepEqual(
      orders,
      [...orders].sort((a, b) => a - b)
    );
    assert.equal(
      new Set(oauthChain.steps.map((s) => s.id)).size,
      orders.length
    );
  });

  for (const step of oauthChain.steps) {
    it(`step ${step.order} ${step.function}() exists in ${step.file} with JSDoc`, async () => {
      const source = await readFile(
        path.join(repoRoot, ...step.file.split("/")),
        "utf-8"
      );

      const { hit, jsdoc } = findFunctionWithJsdoc(source, step.function);
      assert.equal(hit, true, `${step.function} not found in ${step.file}`);
      assert.equal(
        jsdoc,
        true,
        `${step.function} in ${step.file} is missing a JSDoc block`
      );
    });
  }

  it("mounts /auth and /auth/callback on the named handlers", async () => {
    const router = await readFile(
      path.join(repoRoot, "server", "routes", "auth.js"),
      "utf-8"
    );
    assert.match(router, /authRouter\.get\("\/",\s*beginAuth\)/);
    assert.match(
      router,
      /authRouter\.get\("\/callback",\s*handleAuthCallback\)/
    );

    const serverEntry = await readFile(
      path.join(repoRoot, "server", "index.js"),
      "utf-8"
    );
    assert.match(serverEntry, /app\.use\("\/auth",\s*authRouter\)/);
    assert.match(serverEntry, /app\.use\("\/debug",\s*debugRouter\)/);
  });

  it("documents every state/nonce branch with a result and behavior", () => {
    for (const branch of oauthChain.stateNonceBranches) {
      assert.ok(["success", "failure"].includes(branch.result), branch.id);
      assert.ok(branch.check.length > 0, `${branch.id} missing check`);
      assert.ok(branch.behavior.length > 0, `${branch.id} missing behavior`);
    }
  });

  it("declares the unique + TTL session indexes", async () => {
    const model = await readFile(
      path.join(repoRoot, "utils", "models", "SessionModel.js"),
      "utf-8"
    );
    assert.match(
      model,
      /index\(\s*\{\s*shop:\s*1,\s*isOnline:\s*1\s*\}\s*,\s*\{\s*unique:\s*true\s*\}\s*\)/
    );
    assert.match(
      model,
      /index\(\s*\{\s*expires:\s*1\s*\}\s*,\s*\{\s*expireAfterSeconds:\s*0\s*\}\s*\)/
    );
  });
});
