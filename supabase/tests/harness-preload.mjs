// tsx preload: stub `server-only` so the evaluation harness can import the
// ingestion pipeline outside Next.js.
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const stubDir = join(tmpdir(), "vazora-harness-stubs");
if (!existsSync(stubDir)) mkdirSync(stubDir, { recursive: true });
const stub = join(stubDir, "server-only.js");
writeFileSync(stub, "module.exports = {};\n");

const require2 = createRequire(import.meta.url);
const origResolve = require2.resolve;
require2.resolve = function (id, ...args) {
  if (id === "server-only") return stub;
  return origResolve.call(this, id, ...args);
};
