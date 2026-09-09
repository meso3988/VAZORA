import type { AIProvider } from "../provider";

/**
 * Deterministic provider used in Phase 1. It does not call any model; it exists
 * so the domain layer can be developed and tested against the real interface.
 */
export const mockAIProvider: AIProvider = {
  id: "mock",
  async extractObligations() {
    return [];
  },
  async assessEvidence({ obligation }) {
    return {
      status: "partial",
      summary: {
        en: `Automatic assessment is not enabled in this environment. Requirement under clause ${obligation.clauseRef} was not evaluated.`,
        ar: `التقييم الآلي غير مفعّل في هذه البيئة. لم يتم تقييم المتطلب الوارد في المادة ${obligation.clauseRef}.`,
      },
      checks: [],
    };
  },
  async briefOfficer({ obligations }) {
    const open = obligations.filter((o) => o.status !== "verified");
    return {
      headline: {
        en: `${open.length} obligations are open.`,
        ar: `${open.length} التزامات مفتوحة.`,
      },
      items: [],
    };
  },
};
