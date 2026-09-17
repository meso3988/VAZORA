"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseServer } from "@/lib/supabase/server";

const CURRENCIES = new Set(["SAR", "USD", "EUR", "AED"]);
const STATUSES = new Set(["active", "mobilizing", "closeout"]);

/**
 * Real contract creation. organization_id / created_by are derived from the
 * caller's server-side membership — never from client input. RLS also enforces
 * the same rule at the database layer.
 */
export async function createContract(formData: FormData) {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;

  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: "/login", locale });
    throw new Error("unreachable");
  }

  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const contractNumber = String(formData.get("contractNumber") ?? "").trim().slice(0, 60);
  const clientName = String(formData.get("clientName") ?? "").trim().slice(0, 200);
  const rawValue = String(formData.get("contractValue") ?? "").trim();
  const contractValue = rawValue === "" ? null : Math.max(0, Number(rawValue));
  const currency = CURRENCIES.has(String(formData.get("currency"))) ? String(formData.get("currency")) : "SAR";
  const startDate = String(formData.get("startDate") ?? "").slice(0, 10) || null;
  const endDate = String(formData.get("endDate") ?? "").slice(0, 10) || null;
  const projectId = String(formData.get("projectId") ?? "").slice(0, 40) || null;
  const status = STATUSES.has(String(formData.get("status"))) ? String(formData.get("status")) : "active";

  if (title.length < 2 || contractNumber.length < 1) {
    redirect({ href: "/app/contracts/new?error=invalid", locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();

  const { data: row, error } = await supabase
    .from("contracts")
    .insert({
      organization_id: session.organizationId,
      project_id: projectId,
      contract_number: contractNumber,
      title,
      client_name: clientName || null,
      contract_value: contractValue,
      currency,
      start_date: startDate,
      end_date: endDate,
      status,
      created_by: session.user.id,
    })
    .select("id")
    .single();

  if (error || !row) {
    const duplicate = error?.code === "23505"; // unique (organization_id, contract_number)
    redirect({
      href: duplicate ? "/app/contracts/new?error=duplicate" : "/app/contracts/new?error=create",
      locale,
    });
    throw new Error("unreachable");
  }

  await supabase.from("activity_log").insert({
    organization_id: session.organizationId,
    actor_user_id: session.user.id,
    event_type: "contract.created",
    entity_type: "contract",
    entity_id: row.id as string,
    metadata: { contract_number: contractNumber, title },
  });

  redirect({ href: `/app/contracts`, locale });
}
