import type { LocalizedText } from "@/domain/types";

import { CONTRACT_HERO_ID } from "./contracts";

export type PipelineStageKey =
  | "uploaded"
  | "parsing"
  | "clauses"
  | "obligations"
  | "owners"
  | "requests"
  | "ready";

export type PipelineStage = {
  key: PipelineStageKey;
  at: string;
  /** Time this stage took, in seconds. The first stage is instantaneous (0). */
  seconds: number;
  /** Optional numeric count referenced by the label, e.g. clauses or obligations extracted. */
  count?: number;
};

export type Pipeline = {
  contractId: string;
  file: LocalizedText;
  version: number;
  uploadedBy: string;
  stages: PipelineStage[];
};

/**
 * Documented intake run for the hero contract: upload → parse → clauses →
 * obligations → owners → evidence requests → active. Timestamps precede the
 * September evidence/activity events so the demo story stays coherent.
 */
export const DEMO_PIPELINE: Pipeline[] = [
  {
    contractId: CONTRACT_HERO_ID,
    file: { en: "RTA-OM-2026-014 — Main Contract (v3).pdf", ar: "RTA-OM-2026-014 — العقد الرئيسي (النسخة 3).pdf" },
    version: 3,
    uploadedBy: "Rana Al-Otaibi",
    stages: [
      { key: "uploaded", at: "2026-09-01T07:40:12Z", seconds: 0 },
      { key: "parsing", at: "2026-09-01T07:41:15Z", seconds: 63 },
      { key: "clauses", at: "2026-09-01T07:41:56Z", seconds: 41, count: 6 },
      { key: "obligations", at: "2026-09-01T07:42:48Z", seconds: 52, count: 126 },
      { key: "owners", at: "2026-09-01T07:42:57Z", seconds: 9 },
      { key: "requests", at: "2026-09-01T07:43:31Z", seconds: 34 },
      { key: "ready", at: "2026-09-01T07:43:33Z", seconds: 2 },
    ],
  },
];
