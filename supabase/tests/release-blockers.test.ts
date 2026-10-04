// Release blockers B1/B2 — repository-boundary and static wiring tests.
//
// B1: live contract indicators are counted from the operational obligations
//     read (approved + active, organization clock) with explicit states:
//     value (a real zero is allowed), not_calculated, deferred, unavailable,
//     incomplete. A failed or truncated read is never a zero.
// B2: deferred capabilities (risks, claims) are declared in live mode and
//     demo fixtures stay demo-only.
// A simulated read error here is not an outage test: the boundary is the unit.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/release-blockers.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { INDICATOR_READ_LIMIT, readLiveContractIndicators } from "../../src/data/supabase/contract-indicators";
import { demoIndicators, liveIndicatorsFromRows, type ContractIndicators } from "../../src/domain/indicators";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const CLOCK = { today: "2026-10-04", endOfMonth: "2026-10-31" };
const v = (i: ContractIndicators | undefined, k: keyof ContractIndicators) => (i?.[k].state === "value" ? (i[k] as { value: number }).value : i?.[k].state);

/** Fake PostgREST builder: records every filter, resolves to `result`. */
function fakeClient(result: { data: unknown; error: unknown } | "throw") {
  const calls: { op: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const op of ["from", "select", "eq", "in", "limit"]) {
    builder[op] = (...args: unknown[]) => { calls.push({ op, args }); return builder; };
  }
  builder.then = (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
    result === "throw" ? Promise.reject(new Error("network down")).then(ok, bad) : Promise.resolve(result).then(ok, bad);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: builder as any, calls };
}

async function main() {
  // ---------- pure counting ----------
  const rows = [
    { contract_id: "A", due_date_normalized: "2026-09-28" }, // overdue 6d
    { contract_id: "A", due_date_normalized: "2026-10-04" }, // today → due this month
    { contract_id: "A", due_date_normalized: "2026-10-31" }, // end of month → due this month
    { contract_id: "A", due_date_normalized: "2026-11-01" }, // next month
    { contract_id: "A", due_date_normalized: null },         // no normalized date
    { contract_id: "B", due_date_normalized: "2026-10-10" },
    { contract_id: "FOREIGN", due_date_normalized: "2026-01-01" }, // not requested
  ];
  const m = liveIndicatorsFromRows(["A", "B", "C"], rows, CLOCK);
  check("contract with an overdue obligation: overdue = 1", v(m.get("A"), "obligationsOverdue") === 1);
  check("active total counts every operational row incl. no-date", v(m.get("A"), "obligationsTotal") === 5);
  check("due this month: today and end-of-month inclusive, next month and overdue excluded", v(m.get("A"), "obligationsDueThisMonth") === 2);
  check("contract with no overdue obligation: overdue is a real zero", v(m.get("B"), "obligationsOverdue") === 0 && v(m.get("B"), "obligationsTotal") === 1);
  check("contract with no operational obligations: real zeros", v(m.get("C"), "obligationsTotal") === 0 && v(m.get("C"), "obligationsOverdue") === 0);
  check("rows for an unrequested contract are ignored", !m.has("FOREIGN"));
  const live = m.get("A")!;
  check("coverage is not_calculated in live (no implemented formula)", live.evidenceCoverage.state === "not_calculated");
  check("risks / exposure / readiness are deferred in live", ["risksOpen", "riskExposure", "claimReadiness"].every((k) => live[k as keyof ContractIndicators].state === "deferred"));

  // ---------- repository boundary ----------
  const ok = fakeClient({ data: rows.slice(0, 6), error: null });
  const r1 = await readLiveContractIndicators(ok.client, "org-alpha", ["A", "B"], CLOCK);
  const f = (op: string) => ok.calls.filter((c) => c.op === op).map((c) => JSON.stringify(c.args));
  check("reads contract_obligations", f("from")[0] === JSON.stringify(["contract_obligations"]));
  check("scoped to the caller's organization", f("eq").includes(JSON.stringify(["organization_id", "org-alpha"])));
  check("operational definition: approved + active", f("eq").includes(JSON.stringify(["review_status", "approved"])) && f("eq").includes(JSON.stringify(["activation_status", "active"])));
  check("scoped to the page's contracts", f("in")[0] === JSON.stringify(["contract_id", ["A", "B"]]));
  check("bounded read with truncation probe (limit + 1)", f("limit")[0] === JSON.stringify([INDICATOR_READ_LIMIT + 1]));
  check("success → counted values", v(r1.get("A"), "obligationsOverdue") === 1 && v(r1.get("B"), "obligationsTotal") === 1);

  const beta = fakeClient({ data: [], error: null });
  const r2 = await readLiveContractIndicators(beta.client, "org-beta", ["X"], CLOCK);
  check("Alpha vs Beta: each read is filtered by its own organization id", beta.calls.some((c) => c.op === "eq" && JSON.stringify(c.args) === JSON.stringify(["organization_id", "org-beta"])));
  check("genuine empty result → real zeros (not a failure)", v(r2.get("X"), "obligationsTotal") === 0 && v(r2.get("X"), "obligationsOverdue") === 0);

  const err = await readLiveContractIndicators(fakeClient({ data: null, error: { message: "boom" } }).client, "o", ["A", "B"], CLOCK);
  check("returned error → every count unavailable, never zero",
    ["A", "B"].every((id) => ["obligationsTotal", "obligationsDueThisMonth", "obligationsOverdue"].every((k) => err.get(id)?.[k as keyof ContractIndicators].state === "unavailable")));
  const thrown = await readLiveContractIndicators(fakeClient("throw").client, "o", ["A"], CLOCK);
  check("thrown / network error → unavailable", thrown.get("A")?.obligationsOverdue.state === "unavailable");
  const bad = await readLiveContractIndicators(fakeClient({ data: { not: "an array" }, error: null }).client, "o", ["A"], CLOCK);
  check("malformed result → unavailable", bad.get("A")?.obligationsTotal.state === "unavailable");
  const many = Array.from({ length: INDICATOR_READ_LIMIT + 1 }, () => ({ contract_id: "A", due_date_normalized: "2026-09-01" }));
  const trunc = await readLiveContractIndicators(fakeClient({ data: many, error: null }).client, "o", ["A", "B"], CLOCK);
  check("truncated read → incomplete for every contract (no understated count)",
    ["A", "B"].every((id) => trunc.get(id)?.obligationsOverdue.state === "incomplete" && trunc.get(id)?.obligationsTotal.state === "incomplete"));
  check("failure states keep coverage not_calculated and risks deferred", err.get("A")?.evidenceCoverage.state === "not_calculated" && trunc.get("A")?.riskExposure.state === "deferred");
  const none = fakeClient({ data: [], error: null });
  const r3 = await readLiveContractIndicators(none.client, "o", [], CLOCK);
  check("no contracts → no query, no indicators", r3.size === 0 && none.calls.length === 0);

  // ---------- demo stays illustrative ----------
  const d = demoIndicators({ obligationsTotal: 126, obligationsDueThisMonth: 9, obligationsOverdue: 1, evidenceCoverage: 0.82, risksOpen: 3, riskExposure: 410000, claimReadiness: 0.7 });
  check("demo indicators keep fixture figures as values", v(d, "obligationsTotal") === 126 && v(d, "riskExposure") === 410000 && v(d, "claimReadiness") === 0.7);

  // ---------- static wiring ----------
  const provider = src("src/data/supabase/provider.ts");
  check("live provider: no placeholder health object", !/health:\s*\{/.test(provider) && !provider.includes("ZERO_HEALTH"));
  check("live provider: contract value not coerced to 0", !provider.includes("contract_value ?? 0"));
  const list = src("src/app/[locale]/app/contracts/page.tsx");
  check("/app/contracts reads indicators, not contract.health", list.includes("readContractIndicators") && !list.includes(".health."));
  const overview = src("src/app/[locale]/app/contracts/[id]/page.tsx");
  check("overview reads indicators, not contract.health", overview.includes("readContractIndicators") && !/contract\.health(?!Hint)/.test(overview));
  check("overview: risks/claims stub reads are demo-only", overview.includes("isDemo ? db.risks.list") && overview.includes("isDemo ? db.claims.list"));
  check("overview: live shows deferred notices", overview.includes('<DeferredNotice feature="claims"') && overview.includes('<DeferredNotice feature="risks"'));
  const life = src("src/components/app/contract-lifecycle.tsx");
  check("lifecycle: no demo-date default, no contract.health", !life.includes("DEMO_TODAY") && !life.includes("contract.health"));
  check("obligations hint: live denominator is the list's own count", src("src/app/[locale]/app/contracts/[id]/obligations/page.tsx").includes("String(shown)"));
  for (const [file, feature] of [
    ["src/app/[locale]/app/contracts/[id]/risks/page.tsx", "risks"],
    ["src/app/[locale]/app/contracts/[id]/claims/page.tsx", "claims"],
    ["src/app/[locale]/app/claims/page.tsx", "claims"],
  ] as const) {
    const s = src(file);
    check(`${file.split("/app/").pop()}: live returns the ${feature} notice before any stub read`,
      s.includes(`<DeferredNotice feature="${feature}"`) && s.indexOf('session.mode !== "demo"') < s.indexOf(feature === "risks" ? "db.risks.list" : "db.claims.list"));
  }
  check("shell: live claims nav is declared, not linked", src("src/components/app/shell.tsx").includes('!demo && key === "claims"'));
  check("tabs: live risks/claims are declared, not linked", src("src/components/app/contract-tabs.tsx").includes("DEFERRED_TABS") && src("src/app/[locale]/app/contracts/[id]/layout.tsx").includes('deferred={session.mode === "live"}'));
  for (const l of ["en", "ar"]) {
    const msg = JSON.parse(src(`src/messages/${l}.json`));
    check(`${l}: indicator + deferred copy present`, !!msg.app.indicator?.notCalculated && !!msg.app.indicator?.incomplete && !!msg.app.deferred?.risks?.body && !!msg.app.deferred?.claims?.body && !!msg.app.contract?.valueUnknown);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
