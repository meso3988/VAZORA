// Contract read-state consistency — repository-boundary tests.
//
// Scope: readContractList (src/data/read-contract-list.ts) is the single read
// path every contract-list page now uses:
//   /app/dashboard  /app/contracts  /app/tasks  /app/claims  /app/evidence
// The five consumers' three outcomes are exercised here with injected
// providers — a returned error, a thrown/network error, an empty success, a
// populated success, and recovery. A simulated error here is NOT a real
// Supabase outage test; the repository boundary is the unit under test.
// Rendering of the failure branch is additionally verified by the e2e
// smoke test (normal navigation) and asserted statically below.
//
// Run: node --import tsx supabase/tests/contract-read-state.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readContractList } from "../../src/data/read-contract-list";
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
const CONTRACT2 = { id: "c-2", reference: "T-002" } as unknown as Contract;

type ListResult = Contract[] | "error" | "throw" | "throw-then-ok";
function fakeDb(listResult: ListResult, opts: { checked?: ListResult } = {}) {
  const state = { calls: 0 };
  const db = {
    contracts: {
      list: async () => {
        if (listResult === "error") throw new Error("should not be thrown from unchecked list in test");
        if (listResult === "throw") throw new Error("network down");
        return listResult === "throw-then-ok" ? (state.calls++, state.calls > 1 ? [CONTRACT] : (() => { throw new Error("network down"); })()) : (listResult as Contract[]);
      },
      ...(opts.checked === undefined ? {} : {
        listChecked: async () => {
          state.calls++;
          const r = opts.checked!;
          if (r === "error") return { ok: false as const };
          if (r === "throw") throw new Error("network down");
          if (r === "throw-then-ok") {
            if (state.calls <= 1) return { ok: false as const };
            return { ok: true as const, contracts: [CONTRACT] };
          }
          return { ok: true as const, contracts: r };
        },
      }),
    },
  } as unknown as DataProvider;
  return { db, state };
}

const live = false; // isDemo arg name readability

async function main() {
  // ------------------------------------------------------------------
  // readContractList — three outcomes, never an error-as-[] conversion
  // ------------------------------------------------------------------
  {
    const { db } = fakeDb([], { checked: "error" });
    const read = await readContractList(db, "org-1", live);
    check("returned database error → ok:false, not []", read.ok === false && read.contracts.length === 0);
  }
  {
    const { db } = fakeDb([], { checked: "throw" });
    const read = await readContractList(db, "org-1", live);
    check("thrown/network error → ok:false, does not propagate", read.ok === false && read.contracts.length === 0);
  }
  {
    const { db } = fakeDb([], { checked: [] });
    const read = await readContractList(db, "org-1", live);
    check("successful empty → ok:true with []", read.ok === true && read.contracts.length === 0);
  }
  {
    const { db } = fakeDb([], { checked: [CONTRACT, CONTRACT2] });
    const read = await readContractList(db, "org-1", live);
    check("successful populated → ok:true with both contracts", read.ok === true && read.contracts.length === 2);
  }
  {
    const { db } = fakeDb([], { checked: "throw-then-ok" });
    const first = await readContractList(db, "org-1", live);
    const second = await readContractList(db, "org-1", live);
    check("recovery after failure → fail then populated", first.ok === false && second.ok === true && second.contracts.length === 1);
  }
  {
    // Providers without listChecked (mock/demo) still read through list().
    const { db } = fakeDb([CONTRACT]);
    const read = await readContractList(db, "org-1", live);
    check("provider without listChecked → falls back to list()", read.ok === true && read.contracts.length === 1);
  }
  {
    // Demo sessions must use list() even when listChecked exists — fixtures,
    // never a checked tenant read.
    const { db } = fakeDb([CONTRACT], { checked: "error" });
    const read = await readContractList(db, "org-1", /* isDemo */ true);
    check("demo mode uses fixtures via list(), not listChecked", read.ok === true && read.contracts.length === 1);
  }
  {
    // list() itself throwing (e.g. an unchecked provider that can throw)
    // is still an explicit failure, never a propagated crash-as-empty.
    const { db } = fakeDb("throw");
    const read = await readContractList(db, "org-1", live);
    check("throwing list() fallback → ok:false", read.ok === false);
  }

  // ------------------------------------------------------------------
  // The five consumers: each uses readContractList and renders the
  // localized failure branch (never the empty state) on !read.ok
  // ------------------------------------------------------------------
  const consumers: { route: string; file: string; failureRender: string }[] = [
    { route: "/app/dashboard", file: "src/app/[locale]/app/dashboard/page.tsx", failureRender: "dashboard.contractsUnavailable" },
    { route: "/app/contracts", file: "src/app/[locale]/app/contracts/page.tsx", failureRender: "contractsLoadFailed" },
    { route: "/app/tasks", file: "src/app/[locale]/app/tasks/page.tsx", failureRender: "contractsLoadFailed" },
    { route: "/app/claims", file: "src/app/[locale]/app/claims/page.tsx", failureRender: "contractsLoadFailed" },
    { route: "/app/evidence", file: "src/app/[locale]/app/evidence/page.tsx", failureRender: "contractsLoadFailed" },
  ];
  for (const c of consumers) {
    const s = src(c.file);
    check(`${c.route}: uses readContractList`, /readContractList\(/.test(s));
    check(`${c.route}: renders failure state (${c.failureRender})`, s.includes("!read.ok") || s.includes("contractsUnavailable"));
    check(`${c.route}: no unchecked db.contracts.list( for tenant data`, !/db\.contracts\.list\(/.test(s.replace(/listChecked/g, "")));
  }

  // Dashboard keeps unavailable metrics unavailable — count shows "—", not 0.
  {
    const s = src("src/app/[locale]/app/dashboard/page.tsx");
    check("dashboard: failed read → KPI shows em-dash not a count", /contractsUnavailable \? "—" : active\.length/.test(s));
    check("dashboard: failed read → unavailable notice, not live-metrics copy", /contractsUnavailable \? t\("dashboard\.contractsUnavailable"\)/.test(s));
  }

  // Contracts page: distinct branches for failure vs legitimate empty.
  {
    const s = src("src/app/[locale]/app/contracts/page.tsx");
    check("contracts page: failure branch precedes empty state", s.indexOf("!read.ok") < s.indexOf("contracts.length === 0"));
    check("contracts page: count subtitle suppressed on failure", /read\.ok \? t\("count"/.test(s));
  }

  // Evidence page: the upload form's contract picker is hidden on failure —
  // no invented/defaulted upload target.
  {
    const s = src("src/app/[locale]/app/evidence/page.tsx");
    check("evidence: upload form requires read.ok && contracts.length > 0", /read\.ok && contracts\.length > 0/.test(s));
  }

  // ------------------------------------------------------------------
  // Localization: English and Arabic distinguish
  // "No contracts yet" from "Contracts could not be loaded."
  // ------------------------------------------------------------------
  const en = JSON.parse(src("src/messages/en.json"));
  const ar = JSON.parse(src("src/messages/ar.json"));
  check("en: contractsLoadFailed exists and differs from empty title",
    typeof en.common?.contractsLoadFailed === "string"
    && en.common.contractsLoadFailed.length > 0
    && en.common.contractsLoadFailed !== en.app.contracts.empty.title);
  check("en: legitimate empty state intact", en.app.contracts.empty.title === "No contracts yet");
  check("ar: contractsLoadFailed exists and differs from empty title",
    typeof ar.common?.contractsLoadFailed === "string"
    && ar.common.contractsLoadFailed.length > 0
    && ar.common.contractsLoadFailed !== ar.app.contracts.empty.title);
  check("ar: legitimate empty state intact", ar.app.contracts.empty.title === "لا توجد عقود بعد");
  check("en/ar: dashboard unavailable key present in both locales",
    typeof en.app.dashboard?.contractsUnavailable === "string"
    && typeof ar.app.dashboard?.contractsUnavailable === "string");
  check("en/ar failure strings differ (both localized, not copy-paste)",
    en.common.contractsLoadFailed !== ar.common.contractsLoadFailed);

  // ------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
