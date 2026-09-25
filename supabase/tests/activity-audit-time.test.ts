/* eslint-disable @typescript-eslint/no-explicit-any */
// activity_log recording time is database-controlled (migration 0012).
//
// Proves, against the real database with a normal authenticated member:
//   • legitimate activity insertion succeeds, stamped by the database
//   • past and future created_at spoofing is safely overridden
//   • UPDATE and DELETE remain blocked (append-only audit)
//   • "what changed" windows use RECORDING time: a back-dated row cannot hide
//     from "since yesterday", and a future-dated row cannot stay "new"
// Synthetic time uses the injectable Officer clock (buildOfficerContext
// `now`) — no production bypass, no service role.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/activity-audit-time.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runOfficerTool } from "../../src/lib/officer/tools";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const DAY = 86_400_000;
const SKEW = 5 * 60_000; // client/DB clock tolerance

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const stamp = Date.now();
  const { data: auth, error: authErr } = await client.auth.signUp({
    email: `qa-audit-${stamp}@vazora.test`, password: `Qa!${crypto.randomUUID()}`,
  });
  if (authErr || !auth.session) throw new Error(`signUp: ${authErr?.message ?? "no session"}`);
  const userId = auth.user.id as string;
  const orgId = crypto.randomUUID();
  const ins = async (t: string, row: Record<string, unknown>) => {
    const { error } = await client.from(t).insert(row);
    if (error) throw new Error(`${t}: ${error.message}`);
  };
  await ins("organizations", { id: orgId, name: "QA Audit Time", slug: `qa-audit-${stamp}`, created_by: userId, timezone: "Asia/Riyadh" });
  // activity_insert is membership-based (any role); owner is still a normal
  // authenticated user (no service role) and can remove the QA tenant after.
  await ins("organization_members", { organization_id: orgId, user_id: userId, role: "owner" });

  try {
    const log = (event_type: string, extra: Record<string, unknown> = {}) => client.from("activity_log")
      .insert({ organization_id: orgId, actor_user_id: userId, event_type, entity_type: "qa", metadata: {}, ...extra })
      .select("id, created_at").single();
    const near = (iso: string) => Math.abs(Date.parse(iso) - Date.now()) < SKEW;

    // 1. legitimate insertion
    const legit = await log("qa.legit");
    check("legit-insert-succeeds", !legit.error && !!legit.data, legit.error?.message);
    check("legit-insert-db-stamped", !!legit.data && near(legit.data.created_at), legit.data?.created_at);

    // 2. spoofed recording time — must be overridden to database time
    const past = new Date(Date.now() - 3 * DAY).toISOString();
    const future = new Date(Date.now() + 3 * DAY).toISOString();
    const backdated = await log("qa.spoof_past", { created_at: past });
    check("backdate-overridden", !backdated.error && near(backdated.data.created_at),
      backdated.error?.message ?? `stored=${backdated.data?.created_at} attempted=${past}`);
    const forward = await log("qa.spoof_future", { created_at: future });
    check("futuredate-overridden", !forward.error && near(forward.data.created_at),
      forward.error?.message ?? `stored=${forward.data?.created_at} attempted=${future}`);

    // 3. append-only protections unchanged
    const target = legit.data?.id;
    const upd = await client.from("activity_log").update({ event_type: "qa.tampered", created_at: past }).eq("id", target).select("id");
    const del = await client.from("activity_log").delete().eq("id", target).select("id");
    const { data: after } = await client.from("activity_log").select("event_type, created_at").eq("id", target).single();
    check("update-still-blocked", !!upd.error || (upd.data ?? []).length === 0, upd.error?.message ?? "0 rows");
    check("delete-still-blocked", !!del.error || (del.data ?? []).length === 0, del.error?.message ?? "0 rows");
    check("row-unchanged-after-tamper-attempts", after?.event_type === "qa.legit" && after?.created_at === legit.data?.created_at);

    // 4. "what changed" uses recording time
    await ensureOfficerProfile({ supabase: client, organizationId: orgId });
    const nowCtx = await buildOfficerContext({ supabase: client, organizationId: orgId, userId, locale: "en" });
    const window = async (ctx: any) => {
      const r = await runOfficerTool(ctx, "getRecentActivity", { window: "since_yesterday", limit: 200 });
      return new Set(((r.ok ? (r.data as any).events : []) as any[]).map((e) => e.event_type));
    };
    const today = await window(nowCtx);
    check("backdated-row-cannot-hide-from-since-yesterday", today.has("qa.spoof_past"), [...today].join(","));
    check("legit-row-in-since-yesterday", today.has("qa.legit"));
    // Injectable clock two days ahead: rows recorded today are no longer "since yesterday".
    const laterCtx = await buildOfficerContext({ supabase: client, organizationId: orgId, userId, locale: "en", now: new Date(Date.now() + 2 * DAY) });
    const later = await window(laterCtx);
    check("futuredated-row-does-not-stay-new", !later.has("qa.spoof_future"), [...later].join(","));
    check("window-ages-out-by-recording-time", !later.has("qa.legit") && !later.has("qa.spoof_past"));
  } finally {
    const { error } = await client.from("organizations").delete().eq("id", orgId);
    const { count } = await client.from("activity_log").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    check("qa-tenant-cleaned", !error && (count ?? 0) === 0, error?.message ?? `activity rows left=${count}`);
  }

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nACTIVITY AUDIT TIME: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
