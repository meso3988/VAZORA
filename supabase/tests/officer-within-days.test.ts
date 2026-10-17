/* eslint-disable @typescript-eslint/no-explicit-any */
// Officer tool-contract hardening — getUpcomingObligations.withinDays
// (deterministic, no model, no network).
//
// Demonstrated defect (r8+r9 targeted diagnostics, 2026-09-29): the model
// passed withinDays:0 for "due today" — the natural value — but the zod
// min(1) bound was dropped by the JSON-schema serializer, so the failure was
// invisible until the tool rejected it; every run burned a same-turn retry.
// Fix: min(0) where 0 is semantically valid (the filter is
// daysUntilDue >= 0 && <= within — 0 = today only) + the serializer now
// preserves int/min/max so the model sees the real contract.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-within-days.test.ts

import { OFFICER_TOOLS, runOfficerTool } from "../../src/lib/officer/tools";
import { zodObjectToJsonSchema } from "../../src/lib/officer/converse";
import { buildClock } from "../../src/lib/officer/time";
import type { OfficerContext } from "../../src/lib/officer/context";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const ORG = "org-a";
const CONTRACT = "11111111-1111-4111-8111-111111111111";

function stubCtx(): OfficerContext {
  const supabase = {
    from: (t: string) => {
      const res = { data: t === "contract_obligations" ? OBLIGATIONS : t === "contracts" ? CONTRACTS : [] };
      const chain: any = new Proxy({}, {
        get(_t2, prop) {
          if (prop === "then") return (resolve: any) => Promise.resolve({ data: res.data, error: null }).then(resolve);
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: (res.data as any[])?.[0] ?? null, error: null });
          return () => chain;
        },
      });
      return chain;
    },
  };
  return {
    supabase: supabase as never,
    organizationId: ORG,
    userId: "user-1",
    role: "owner",
    clock: buildClock(new Date("2026-09-29T12:00:00Z"), "Asia/Riyadh"),
    locale: "en",
    organizationName: "Benchmark Org",
    officer: { displayName: "Officer", preferredLanguage: "auto", tone: "professional", enabled: true },
  };
}

const CONTRACTS = [{ id: CONTRACT, contract_number: "ALPHA-100", title: "Alpha" }];
// 2026-09-29 is "today" in Asia/Riyadh for the stub clock.
const OBLIGATIONS = [
  { id: "o-today", contract_id: CONTRACT, title: "Due today", due_date_normalized: "2026-09-29", review_status: "approved", activation_status: "active" },
  { id: "o-tomorrow", contract_id: CONTRACT, title: "Due tomorrow", due_date_normalized: "2026-09-30", review_status: "approved", activation_status: "active" },
  { id: "o-week", contract_id: CONTRACT, title: "Due in a week", due_date_normalized: "2026-10-06", review_status: "approved", activation_status: "active" },
  { id: "o-overdue", contract_id: CONTRACT, title: "Overdue", due_date_normalized: "2026-09-28", review_status: "approved", activation_status: "active" },
];

async function dueIds(args: Record<string, unknown>): Promise<{ ok: boolean; ids: string[]; error?: string }> {
  const r = await runOfficerTool(stubCtx(), "getUpcomingObligations", args);
  if (!r.ok) return { ok: false, ids: [], error: r.error };
  const data = r.data as { obligations: { id: string }[] };
  return { ok: true, ids: data.obligations.map((o) => o.id) };
}

async function main() {
  // ---------- boundary semantics ----------
  {
    const r = await dueIds({ withinDays: 0 });
    check("withinDays=0 accepted", r.ok, r.error);
    check("withinDays=0 → today only", r.ok && r.ids.join(",") === "o-today", JSON.stringify(r.ids));
  }
  {
    const r = await dueIds({ withinDays: 1 });
    check("withinDays=1 → today + tomorrow", r.ok && r.ids.join(",") === "o-today,o-tomorrow", JSON.stringify(r.ids));
  }
  {
    const r = await dueIds({ withinDays: 365 });
    check("withinDays=365 accepted (incl. week-out, excl. overdue)",
      r.ok && r.ids.join(",") === "o-today,o-tomorrow,o-week", JSON.stringify(r.ids));
  }
  {
    const r = await dueIds({ withinDays: -1 });
    check("withinDays=-1 rejected", !r.ok && /invalid_arguments/.test(r.error ?? ""), r.error);
  }
  {
    const r = await dueIds({ withinDays: 366 });
    check("withinDays=366 rejected", !r.ok && /invalid_arguments/.test(r.error ?? ""), r.error);
  }
  {
    const r = await dueIds({ withinDays: 1.5 });
    check("withinDays=1.5 (non-integer) rejected", !r.ok && /invalid_arguments/.test(r.error ?? ""), r.error);
  }
  {
    const r = await dueIds({});
    check("withinDays omitted → default 7-day window", r.ok && r.ids.join(",") === "o-today,o-tomorrow,o-week", JSON.stringify(r.ids));
  }

  // ---------- schema shown to the model ----------
  const tool = OFFICER_TOOLS.get("getUpcomingObligations")!;
  const schema = zodObjectToJsonSchema(tool.input) as any;
  const prop = schema.properties?.withinDays ?? {};
  check("model-facing schema: withinDays integer", prop.type === "integer", JSON.stringify(prop));
  check("model-facing schema: withinDays minimum 0 visible", prop.minimum === 0, JSON.stringify(prop));
  check("model-facing schema: withinDays maximum 365 visible", prop.maximum === 365, JSON.stringify(prop));
  check("model-facing schema: description states 0=today", /0 = due today only/.test(tool.description), tool.description);

  // ---------- generic converter: other numeric schema gains its bounds ----------
  const activity = OFFICER_TOOLS.get("getRecentActivity");
  if (activity) {
    const p = (zodObjectToJsonSchema(activity.input) as any).properties?.limit ?? {};
    check("converter is generic: activity limit exposes min/max", p.minimum === 1 && p.maximum === 25, JSON.stringify(p));
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length} passed · ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
