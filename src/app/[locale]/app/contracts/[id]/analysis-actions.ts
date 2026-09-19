"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { runContractIngestion } from "@/lib/ingestion/run";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Starts contract ingestion for a live tenant. The contract lookup and all
 * persistence go through RLS with the caller's JWT, and the organization id
 * is derived from the session — never from the browser.
 */
export async function analyzeContract(formData: FormData) {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const back = (params: string) => `/app/contracts/${contractId}${params}`;

  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: back("?analysis=cfg"), locale });
    throw new Error("unreachable");
  }

  // No extraction provider configured → explicit configuration state, never fake results.
  const { getExtractionProvider } = await import("@/lib/ingestion/extractor");
  await import("@/lib/ingestion/openai-compat");
  if (!getExtractionProvider()) {
    redirect({ href: back("?analysis=unconfigured"), locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, title")
    .eq("id", contractId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!contract) {
    redirect({ href: "/app/contracts?error=forbidden", locale });
    throw new Error("unreachable");
  }

  await supabase.from("activity_log").insert({
    organization_id: session.organizationId,
    actor_user_id: session.user.id,
    event_type: "contract.analysis_started",
    entity_type: "contract",
    entity_id: contractId,
  });

  try {
    const result = await runContractIngestion({
      supabase,
      organizationId: session.organizationId,
      contractId,
      userId: session.user.id,
      contractTitle: contract.title as string,
    });
    if (result.status === "failed") {
      const { data: run } = await supabase
        .from("contract_ingestion_runs")
        .select("error_code")
        .eq("id", result.runId)
        .maybeSingle();
      redirect({ href: back(`?analysis=fail&code=${run?.error_code ?? "unknown"}`), locale });
    }
    redirect({ href: back(`?analysis=ok&n=${result.obligations}`), locale });
  } catch (e) {
    // redirect() throws NEXT_REDIRECT — let it through.
    if (e && typeof e === "object" && "digest" in (e as object) && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "no_documents") redirect({ href: back("?analysis=nodocs"), locale });
    redirect({ href: back("?analysis=fail&code=unexpected"), locale });
  }
  throw new Error("unreachable");
}
