// Contract documents read-state — repository-boundary test with test-only
// dependency injection.
//
// Scope: documents.list on the contract-overview documents panel — a failed
// read must never render as "no documents" (documents.list previously turned
// a Supabase error into []). The units under test are readDocumentList
// (checked-read boundary) and the panel wiring; simulated failures are NOT
// a real Supabase outage test.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/document-read-state.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readDocumentList } from "../../src/data/checked-reads";
import type { DataProvider } from "../../src/data/repositories";
import type { ContractDocument } from "../../src/domain/types";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const DOC = { id: "doc-1", contractId: "c1", fileName: "msa.pdf" } as unknown as ContractDocument;

/* ---------- repository-boundary fakes ---------- */

type ListResult = "populated" | "empty" | "error" | "throw" | "fail-then-populated";
function fakeDocumentsDb(result: ListResult) {
  const state = { checkedCalls: 0, legacyCalls: 0, queried: [] as string[] };
  const db = {
    documents: {
      list: async (orgId: string, contractId: string) => {
        state.legacyCalls++;
        state.queried.push(`${orgId}/${contractId}`);
        return [DOC];
      },
      listChecked: async (orgId: string, contractId: string) => {
        state.checkedCalls++;
        state.queried.push(`${orgId}/${contractId}`);
        const r = result === "fail-then-populated" ? (state.checkedCalls === 1 ? "error" : "populated") : result;
        if (r === "error") return { ok: false as const };
        if (r === "throw") throw new Error("network down");
        return { ok: true as const, documents: r === "empty" ? [] : [DOC] };
      },
    },
  } as unknown as DataProvider;
  return { db, state };
}

async function boundaryTests() {
  {
    const { db, state } = fakeDocumentsDb("populated");
    const r = await readDocumentList(db, "org", "c1", false);
    check("documents.list populated → ok + rows", r.ok && r.documents.length === 1);
    check("documents.list populated used listChecked", state.checkedCalls === 1 && state.legacyCalls === 0);
  }
  {
    const { db } = fakeDocumentsDb("empty");
    const r = await readDocumentList(db, "org", "c1", false);
    check("documents.list successful-empty → ok:true + []", r.ok && r.documents.length === 0);
  }
  {
    const { db } = fakeDocumentsDb("error");
    const r = await readDocumentList(db, "org", "c1", false);
    check("documents.list returned error → ok:false (never [])", !r.ok);
  }
  {
    const { db } = fakeDocumentsDb("throw");
    const r = await readDocumentList(db, "org", "c1", false);
    check("documents.list thrown error → ok:false", !r.ok);
  }
  {
    const { db } = fakeDocumentsDb("fail-then-populated");
    const r1 = await readDocumentList(db, "org", "c1", false);
    const r2 = await readDocumentList(db, "org", "c1", false);
    check("documents.list recovery after failure", !r1.ok && r2.ok && r2.documents.length === 1);
  }
  {
    // Live provider without listChecked → explicit failure, never silent legacy list().
    const { db, state } = fakeDocumentsDb("populated");
    delete (db.documents as unknown as Record<string, unknown>).listChecked;
    const r = await readDocumentList(db, "org", "c1", false);
    check("documents live without listChecked → ok:false (no silent fallback)", !r.ok && state.legacyCalls === 0);
  }
  {
    // Tenant scope: the org/contract pair reaches the checked reader verbatim.
    const { db, state } = fakeDocumentsDb("populated");
    const r = await readDocumentList(db, "org-tenant-a", "contract-9", false);
    check("documents.listChecked is tenant+contract scoped",
      r.ok && state.queried.length === 1 && state.queried[0] === "org-tenant-a/contract-9");
  }
  {
    // Demo sessions read fixtures via list() even when listChecked exists.
    const { db, state } = fakeDocumentsDb("populated");
    const r = await readDocumentList(db, "demo-org", "c1", true);
    check("documents demo → fixtures via list()", r.ok && state.legacyCalls === 1 && state.checkedCalls === 0);
  }
}

/* ---------- provider + consumer wiring + messaging (static) ---------- */

function wiringTests() {
  const provider = src("src/data/supabase/provider.ts");
  check("supabase documents.listChecked exists", /documents[\s\S]*?async listChecked\(/.test(provider));
  check("supabase documents.listChecked preserves errors (no silent [])",
    /async listChecked\(organizationId, contractId\)[\s\S]*?if \(error \|\| !Array\.isArray\(data\)\) return \{ ok: false \}/.test(provider));
  check("supabase documents.listChecked is tenant+contract scoped",
    /async listChecked\(organizationId, contractId\)[\s\S]*?\.eq\("organization_id", organizationId\)[\s\S]*?\.eq\("contract_id", contractId\)/.test(provider));

  const overview = src("src/app/[locale]/app/contracts/[id]/page.tsx");
  check("overview uses readDocumentList", overview.includes("readDocumentList("));
  check("overview has no unchecked db.documents.list", !overview.includes("db.documents.list("));
  check("overview derives nullable documents from the read",
    overview.includes("documentsRead.ok ? documentsRead.documents : null"));

  const panel = src("src/components/app/document-panel.tsx");
  check("panel accepts a failed read (documents | null)", panel.includes("ContractDocument[] | null"));
  check("panel failure renders DataLoadFailed, not the empty state",
    /documents === null[\s\S]*?DataLoadFailed/.test(panel) && !/documents === null[\s\S]*?labels\.empty/.test(panel.slice(0, panel.indexOf("documents.length === 0"))));

  const en = JSON.parse(src("src/messages/en.json"));
  const ar = JSON.parse(src("src/messages/ar.json"));
  check("EN load-failure message exists", typeof en.common?.dataLoadFailed === "string" && en.common.dataLoadFailed.length > 0);
  check("AR load-failure message exists", typeof ar.common?.dataLoadFailed === "string" && ar.common.dataLoadFailed.length > 0);
  check("EN empty-state message still exists (genuine empty list copy)",
    typeof en.app?.documents?.empty === "string" && en.app.documents.empty.length > 0);
  check("AR empty-state message still exists (genuine empty list copy)",
    typeof ar.app?.documents?.empty === "string" && ar.app.documents.empty.length > 0);
}

async function main() {
  await boundaryTests();
  wiringTests();
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length} passed · ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
