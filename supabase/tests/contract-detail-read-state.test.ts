// Contract-detail read-state — repository-boundary tests.
//
// Scope: readContract (src/data/read-contract-list.ts) is the single read
// path for the nine contracts/[id] consumers (layout + 8 pages). Simulated
// failures are NOT a real Supabase outage test; the repository boundary is
// the unit under test. Failure-branch rendering is asserted statically and
// the not-found branch is exercised in the real-browser smoke test.
//
// Run: node --import tsx supabase/tests/contract-detail-read-state.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readContract, readContractList } from "../../src/data/read-contract-list";
import type { DataProvider } from "../../src/data/repositories";
import type { Contract } from "../../src/domain/types";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const CONTRACT = { id: "c-1", reference: "T-001" } as unknown as Contract;
const ID = "11111111-2222-3333-4444-555555555555";
const FOREIGN_ID = "99999999-8888-7777-6666-555555555555";

type GetResult = "found" | "not_found" | "error" | "throw" | "fail-then-found";
function fakeDb(result: GetResult, opts: { legacyNullOnError?: boolean } = {}) {
  const state = { checkedCalls: 0, uncheckedCalls: 0, queriedIds: [] as string[] };
  const db = {
    contracts: {
      getById: async (org: string, id: string) => {
        state.uncheckedCalls++;
        state.queriedIds.push(id);
        if (opts.legacyNullOnError && (result === "error" || result === "throw")) return null;
        return result === "found" || result === "fail-then-found" ? CONTRACT : null;
      },
      getByIdChecked: async (org: string, id: string) => {
        state.checkedCalls++;
        state.queriedIds.push(id);
        const r = result === "fail-then-found" ? (state.checkedCalls === 1 ? "error" : "found") : result;
        if (r === "error") return { status: "unavailable" as const };
        if (r === "throw") throw new Error("network down");
        return r === "found"
          ? { status: "found" as const, contract: CONTRACT }
          : { status: "not_found" as const };
      },
    },
  } as unknown as DataProvider;
  return { db, state };
}

// Simulates the tenant-scoped foreign-id read: another tenant's id matches
// no row under this org's query — the caller learns only not_found.
function foreignTenantDb() {
  const db = {
    contracts: {
      getById: async () => null,
      getByIdChecked: async () => ({ status: "not_found" as const }),
    },
  } as unknown as DataProvider;
  return db;
}

async function main() {
  // ------------------------------------------------------------------
  // readContract — three outcomes at the boundary
  // ------------------------------------------------------------------
  {
    const { db } = fakeDb("found");
    const r = await readContract(db, "org-1", ID, false);
    check("found → status found with contract", r.status === "found" && r.contract.id === "c-1");
  }
  {
    const { db } = fakeDb("not_found");
    const r = await readContract(db, "org-1", ID, false);
    check("successful not-found → status not_found", r.status === "not_found");
  }
  {
    const { db } = fakeDb("error");
    const r = await readContract(db, "org-1", ID, false);
    check("returned database error → unavailable, not not_found", r.status === "unavailable");
  }
  {
    const { db } = fakeDb("throw");
    const r = await readContract(db, "org-1", ID, false);
    check("thrown/network error → unavailable, does not propagate", r.status === "unavailable");
  }
  {
    const { db } = fakeDb("fail-then-found");
    const first = await readContract(db, "org-1", ID, false);
    const second = await readContract(db, "org-1", ID, false);
    check("recovery after failure → unavailable then found",
      first.status === "unavailable" && second.status === "found");
  }
  {
    const db = foreignTenantDb();
    const r = await readContract(db, "org-1", FOREIGN_ID, false);
    check("foreign-tenant id → not_found, no existence disclosure", r.status === "not_found");
  }
  {
    const { db, state } = fakeDb("found");
    const r = await readContract(db, "org-1", "not-a-uuid", false);
    check("malformed id → not_found without a database query",
      r.status === "not_found" && state.checkedCalls === 0 && state.uncheckedCalls === 0);
  }
  {
    // Explicit demo mode: fixtures via getById, never a failure fallback.
    // Demo ids are not UUIDs (ctr_*), so this also proves the UUID format
    // check applies to live ids only — a regression caught in review.
    const { db, state } = fakeDb("found");
    const r = await readContract(db, "org-demo", "ctr_nds_dc_2025", true);
    check("demo mode reads non-UUID fixtures via getById",
      r.status === "found" && state.uncheckedCalls === 1 && state.checkedCalls === 0);
  }
  {
    const { db, state } = fakeDb("found");
    const r = await readContract(db, "org-1", "ctr_nds_dc_2025", false);
    check("non-UUID id in live mode → not_found without a query",
      r.status === "not_found" && state.checkedCalls === 0);
  }
  {
    // Demo fixture lookup that misses is a legitimate not_found.
    const { db } = fakeDb("not_found");
    const r = await readContract(db, "org-demo", ID, true);
    check("demo not-found → not_found", r.status === "not_found");
  }
  {
    // Live without an error-preserving reader: explicit unavailable.
    const db = { contracts: { getById: async () => CONTRACT } } as unknown as DataProvider;
    const r = await readContract(db, "org-1", ID, false);
    check("live without getByIdChecked → unavailable (no silent legacy fallback)",
      r.status === "unavailable");
  }

  // ------------------------------------------------------------------
  // readContractList — live fallback policy after this change
  // ------------------------------------------------------------------
  {
    const db = { contracts: { list: async () => [CONTRACT] } } as unknown as DataProvider;
    const r = await readContractList(db, "org-1", false);
    check("live without listChecked → ok:false explicit unavailable", r.ok === false);
  }
  {
    const db = { contracts: { list: async () => [CONTRACT], listChecked: async () => ({ ok: true as const, contracts: [CONTRACT] }) } } as unknown as DataProvider;
    const r = await readContractList(db, "org-1", true);
    check("demo still reads list() fixtures", r.ok === true && r.contracts.length === 1);
  }

  // ------------------------------------------------------------------
  // The nine consumers: checked read, three branches, no raw getById
  // ------------------------------------------------------------------
  const consumers = [
    "src/app/[locale]/app/contracts/[id]/layout.tsx",
    "src/app/[locale]/app/contracts/[id]/page.tsx",
    "src/app/[locale]/app/contracts/[id]/evidence/page.tsx",
    "src/app/[locale]/app/contracts/[id]/activity/page.tsx",
    "src/app/[locale]/app/contracts/[id]/review/page.tsx",
    "src/app/[locale]/app/contracts/[id]/risks/page.tsx",
    "src/app/[locale]/app/contracts/[id]/officer/page.tsx",
    "src/app/[locale]/app/contracts/[id]/obligations/page.tsx",
    "src/app/[locale]/app/contracts/[id]/claims/page.tsx",
  ];
  for (const f of consumers) {
    const s = src(f);
    const name = f.split("/").slice(-2).join("/");
    check(`${name}: uses readContract`, /readContract\(db, orgId, id/.test(s));
    check(`${name}: unavailable → ContractLoadFailed`, /read\.status === "unavailable"\)\s*return <ContractLoadFailed/.test(s));
    check(`${name}: not_found → notFound()`, /read\.status === "not_found"\)\s*notFound\(\)/.test(s));
    check(`${name}: no unchecked db.contracts.getById`, !/db\.contracts\.getById\(/.test(s));
  }
  {
    const s = src("src/app/[locale]/app/contracts/[id]/layout.tsx");
    check("layout: failure branch precedes children render", s.indexOf('read.status === "unavailable"') < s.indexOf("props.children"));
  }

  // ------------------------------------------------------------------
  // Localization — EN and AR render the unavailable state distinctly
  // ------------------------------------------------------------------
  const en = JSON.parse(src("src/messages/en.json"));
  const ar = JSON.parse(src("src/messages/ar.json"));
  check("en: contractLoadFailed present",
    typeof en.common?.contractLoadFailed === "string" && en.common.contractLoadFailed.length > 0);
  check("ar: contractLoadFailed present",
    typeof ar.common?.contractLoadFailed === "string" && ar.common.contractLoadFailed.length > 0);
  check("en/ar detail failure strings differ (both localized)",
    en.common.contractLoadFailed !== ar.common.contractLoadFailed);
  check("failure wording distinct from not-found semantics in both locales",
    !/not found|غير موجود/.test(en.common.contractLoadFailed + ar.common.contractLoadFailed));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
