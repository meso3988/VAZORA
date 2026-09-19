import "server-only";

import type { ContractExtractionProvider, ContractExtractionResult } from "@/lib/ingestion/extractor";
import type { ObligationExtraction } from "@/lib/ingestion/schema";

/**
 * TEST-ONLY deterministic extraction provider.
 *
 * Enabled ONLY when:
 *   VAZORA_EXTRACTION_PROVIDER=test-fixture
 *
 * AND NODE_ENV is not "production" — the factory refuses outside dev/test.
 *
 * Behavior: reads the synthetic benchmark's ground-truth JSON matching the
 * contract title (we inject the benchmark id into the test QA contract title)
 * and returns its obligations verbatim, with provenance marked "explicit" and
 * source snippets drawn from the real wording in the documents. E2E/ex it
 * exercises the full pipeline — parsing, chunking, validation, consolidation,
 * persistence — without pretending to be AI.
 *
 * Never register globally: `registerTestFixtureProvider()` is the only entry.
 */
export function registerTestFixtureProvider(
  register: (id: string, factory: () => ContractExtractionProvider) => void,
) {
  register("test-fixture", () => testFixtureProvider);
}

const providerImpl: ContractExtractionProvider = {
  id: "test-fixture",
  model: "fixture/ground-truth",
  async extractChunk({ contractTitle, chunk }): Promise<ContractExtractionResult> {
    const match = contractTitle.match(/bench-(ar|en|mixed)-[a-z-]+/i);
    if (!match) {
      return { ok: true, obligations: [] };
    }
    const id = match[0].toLowerCase();
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    try {
      const path = join(process.cwd(), "supabase/tests/fixtures", `${id}.ground-truth.json`);
      const truth = JSON.parse(readFileSync(path, "utf8")) as {
        benchmark: string;
        obligations: {
          clause: string;
          requirement: string;
          frequency: string | null;
          due_rule: string | null;
          evidence: string[];
          payment_linked: boolean | null;
          financial: string | null;
          external_dependency: string | null;
          submission: { destination: string; channel: string; deadline_rule: string } | null;
          owner_role: string | null;
        }[];
        addendumConflict?: {
          mainClause: string;
          requirement: string;
          addendumDueRule: string;
          addendumRaw: string;
        }[];
      };

      // Only obligations whose clause is present in this chunk.
      const keys = new Set<string>();
      for (const s of chunk.segments) {
        if (s.clauseNumber) keys.add(s.clauseNumber.trim().toLowerCase());
        const m = s.text.match(/(?:المادة|البند|Clause|Section)\s*([0-9]+(?:[.\-/][0-9]+)*)/i);
        if (m) keys.add(m[1].toLowerCase());
      }
      const isAddendumDoc = chunk.documentNames?.some((n) => /addendum/i.test(n));
      let grounded = truth.obligations.filter((o) => [...keys].some((k) => k === o.clause.toLowerCase() || k.startsWith(o.clause.toLowerCase() + ".")));

      // Addendum documents carry the same requirement with a modified due rule —
      // surface as a conflict variant, never replacing the main clause.
      if (isAddendumDoc && truth.addendumConflict?.length) {
        grounded = [
          ...grounded,
          ...truth.addendumConflict
            .filter((c) => [...keys].some((k) => k === c.mainClause.toLowerCase() || k.startsWith(c.mainClause.toLowerCase() + ".")))
            .map((c) => ({
              clause: c.mainClause,
              requirement: c.requirement,
              frequency: "monthly",
              due_rule: c.addendumDueRule,
              evidence: [],
              payment_linked: null,
              financial: null,
              external_dependency: null,
              submission: null,
              owner_role: null,
            })),
        ];
      }
      if (!grounded.length) return { ok: true, obligations: [] };

      const obligations: ObligationExtraction[] = grounded.map((o) => {
        const seg = chunk.segments.find(
          (s) => s.clauseNumber && s.clauseNumber.trim().toLowerCase() === o.clause.trim().toLowerCase(),
        ) ?? chunk.segments[0];
        const snippet = (seg?.text ?? "").slice(0, 200);
        return {
        title: o.requirement,
        requirement_text: o.requirement,
        obligation_type: o.frequency ? "reporting" : o.financial ? "payment" : "other",
        frequency: o.frequency,
        due_rule_raw: o.due_rule === "monthly_day_5" ? "في اليوم الخامس من كل شهر" : o.due_rule === "day_10_after_period_end" ? "by day 10 after period end" : o.due_rule,
        due_rule_normalized: o.due_rule,
        owner_role_suggested: o.owner_role,
        approver_role_suggested: null,
        external_dependency: o.external_dependency,
        payment_linked: o.payment_linked,
        payment_link_note: o.payment_linked ? `clause ${o.clause}` : null,
        financial_condition: o.financial,
        penalty_condition: o.financial === "penalty" ? "0.5% per week" : null,
        risk_note: null,
        submission_required: o.submission ? true : null,
        submission_destination: o.submission?.destination ?? null,
        submission_channel: (o.submission?.channel as "portal") ?? null,
        submission_deadline_rule: o.submission?.deadline_rule ?? null,
        requires_external_acknowledgement: o.external_dependency ? true : null,
        ai_confidence: 0.9,
        field_provenance: Object.fromEntries(
          Object.entries({
            requirement: "explicit",
            frequency: o.frequency ? "explicit" : "unknown",
            due: o.due_rule ? "explicit" : "unknown",
            evidence: o.evidence.length ? "explicit" : "unknown",
            owner: o.owner_role ? "inferred" : "unknown",
            payment: o.payment_linked === null ? "unknown" : "explicit",
            external: o.external_dependency ? "explicit" : "unknown",
            submission: o.submission ? "explicit" : "unknown",
          }) as [string, "explicit" | "inferred" | "unknown"][],
        ),
        evidence_requirements: o.evidence.map((name) => ({ name, evidence_type: "document" as const, required: true })),
        source_clause_number: o.clause,
        source_snippet: snippet.trim() || o.requirement,
        review_reason: null,
      }
      });
      return { ok: true, obligations };
    } catch (e) {
      return { ok: false, error: `fixture bench not found for ${id}: ${e instanceof Error ? e.message : ""}` };
    }
  },
};

export const testFixtureProvider: ContractExtractionProvider = providerImpl;
