// QA-only replay stub — NOT product code. Answers POST /v1/chat/completions
// with the raw response recorded for request #1 of the 2026-10-05 live
// journey (the one real extraction), after RS_DELAY_MS. No model is called;
// request headers are never logged or stored.
// Run: RS_DELAY_MS=84000 node --import tsx supabase/tests/qa-replay-stub.mts

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.RS_PORT ?? 8788);
const DELAY = Number(process.env.RS_DELAY_MS ?? 0);
const rows = readFileSync("supabase/tests/evidence/2026-10-05-release-completion/live-journey/proxy-log.jsonl", "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));
const recorded = rows.find((r) => r.seq === 1).rawResponse as string;
let served = 0;

createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  served++;
  const t0 = Date.now();
  console.log(`#${served} ${req.method} ${req.url} — replying after ${DELAY} ms`);
  setTimeout(() => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(recorded);
    console.log(`#${served} replied after ${Date.now() - t0} ms`);
  }, DELAY);
}).listen(PORT, "127.0.0.1", () => console.log(`qa-replay-stub on 127.0.0.1:${PORT}, delay ${DELAY} ms`));
