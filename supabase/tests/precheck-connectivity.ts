import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const TIMEOUT_MS = 20000;

async function timed(label: string, fn: () => Promise<unknown>) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`OK   ${label} (${Date.now() - t0}ms)`);
    return true;
  } catch (caught: unknown) {
    const err = caught as { message?: string; cause?: { code?: string } } | null | undefined;
    console.log(`FAIL ${label} (${Date.now() - t0}ms): ${err?.message ?? err} ${err?.cause ? `cause=${err.cause.code ?? err.cause}` : ""}`);
    return false;
  }
}

async function main() {
  console.log(`precheck url=${url}`);
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) },
  });

  let ok = true;
  // GoTrue host/TLS path — the signUp call that timed out lives here
  ok = (await timed("auth health", async () => {
    const r = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status !== 200 && r.status !== 401 && r.status !== 403) throw new Error(`status ${r.status}`);
  })) && ok;
  // PostgREST path — the seed read/write path uses this
  ok = (await timed("postgrest select", async () => {
    const { error } = await client.from("contracts").select("id").limit(1);
    if (error && !/row-level security|permission denied/i.test(String(error.message))) throw new Error(error.message);
  })) && ok;
  ok = (await timed("postgrest select x2", async () => {
    const { error } = await client.from("contracts").select("id").limit(1);
    if (error && !/row-level security|permission denied/i.test(String(error.message))) throw new Error(error.message);
  })) && ok;

  console.log(ok ? "PRECHECK: HEALTHY" : "PRECHECK: INFRA BLOCKED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error("precheck threw", err); process.exit(1); });
