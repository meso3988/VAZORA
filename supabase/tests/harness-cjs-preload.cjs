/* eslint-disable @typescript-eslint/no-require-imports */
// CJS preload patch: alias `server-only` to an empty module. Works with tsx.
const M = require("node:module");
const path = require("node:path");
const stub = path.resolve(__dirname, "server-only.stub.mjs");
const orig = M._resolveFilename;
M._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return stub;
  return orig.call(this, request, ...rest);
};
