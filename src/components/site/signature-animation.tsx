"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { VazoraMonument } from "@/components/brand/vazora-monument";
import { EvidenceEnvironment } from "@/components/brand/evidence-environment";
import {
  EvidenceConvergence,
  type VerificationState,
} from "@/components/brand/threads";
import { useNarrativePlayback } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * Signature hero sequence — one continuous causal chain:
 * source → clause → requirement → receipt → verification → partial result →
 * corrective request → new receipt → re-verification → verified result → impact.
 * Receipt never closes the gap. Only the verified result permits convergence;
 * downstream changes follow as a separate event. The sequence runs once in view.
 * Spatial layers distinguish source, inspection and operational impact.
 * Arabic and mobile layouts are independently composed with logical positioning.
 */
const STATES: VerificationState[] = [
  "unverified",
  "unverified",
  "unverified",
  "received",
  "verifying",
  "partial",
  "requested",
  "resubmitted",
  "reverifying",
  "verified",
  "verified",
];
const STAGES = [
  "source",
  "clause",
  "requirement",
  "received",
  "verifying",
  "partial",
  "requested",
  "resubmitted",
  "reverifying",
  "verified",
  "impact",
];

export function SequenceControls({
  playback,
}: {
  playback: ReturnType<typeof useNarrativePlayback>;
}) {
  const t = useTranslations("mineral.controls");
  return (
    <div className="sequence-controls">
      <button
        type="button"
        onClick={() => playback.seek(playback.step - 1)}
        disabled={playback.step === 0}
        aria-label={t("previous")}
      >
        <ArrowLeft size={15} className="rtl:-scale-x-100" />
      </button>
      {!playback.reduce && (
        <button
          type="button"
          onClick={playback.toggle}
          disabled={playback.atEnd}
          aria-label={t(playback.playing ? "pause" : "play")}
        >
          {playback.playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
      )}
      <button
        type="button"
        onClick={() => playback.seek(playback.step + 1)}
        disabled={playback.atEnd}
        aria-label={t("next")}
      >
        <ArrowRight size={15} className="rtl:-scale-x-100" />
      </button>
      <button type="button" onClick={playback.replay} aria-label={t("replay")}>
        <RotateCcw size={14} />
      </button>
      {playback.reduce && <small>{t("reduced")}</small>}
    </div>
  );
}

const HERO_DURATIONS = [600, 700, 900, 1000, 1200, 900, 800, 1000, 1200, 1500, 0] as const;

export function SignatureAnimation({ className, introduction }: { className?: string; introduction?: ReactNode }) {
  const t = useTranslations("mineral.hero");
  const common = useTranslations("mineral");
  const locale = useLocale();
  const steps = t.raw("steps") as { title: string; body: string }[];
  const ref = useRef<HTMLDivElement>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const handleReady = useCallback(() => setSceneReady(true), []);
  const playback = useNarrativePlayback(ref, STATES.length, HERO_DURATIONS, sceneReady);
  const { step } = playback;
  const verified = step >= 9;
  const impacted = step === 10;
  const evidenceFile =
    step < 3
      ? "—"
      : step >= 7
        ? "Signed_Acceptance.pdf"
        : "Maintenance_Sep.pdf";

  return (
    <div
      ref={ref}
      className={cn("signature-system", className)}
      data-stage={STAGES[step]}
      aria-label={t("watch")}
    >
      <div className="hero-opening">
        {introduction}
        <div className="hero-artwork" aria-hidden="true" data-proof-state={STATES[step]} data-playing={playback.playing}>
          {/* Integrated Precision HUD Telemetry (No Clumsy Boxes) */}
          <div className="monument-hud">
            <div className="hud-channel hud-requirement" data-active={step >= 1}>
              <div className="hud-meta">
                <span className="hud-beacon hud-beacon-req" />
                <span className="hud-label">{common("thread.requirement")}</span>
                <span className="hud-code" dir="ltr">§ 8.4</span>
              </div>
              <div className="hud-data">
                <span className="hud-title">{t("clause")}</span>
                <span className="hud-detail">{t("ack")}</span>
              </div>
            </div>

            <div className="hud-channel hud-evidence" key={step >= 7 ? "additional" : "initial"} data-active={step >= 3}>
              <div className="hud-meta">
                <span className="hud-beacon hud-beacon-evi" />
                <span className="hud-label">{common("thread.evidence")}</span>
                <span className="hud-code" dir="ltr">DOC—02</span>
              </div>
              <div className="hud-data">
                <span className="hud-title">{t(step < 3 ? "expected" : step >= 7 ? "newFile" : "file")}</span>
                <span className="hud-detail" dir={step >= 3 ? "ltr" : undefined} title={evidenceFile}>
                  {step < 3 ? common("thread.unverified") : evidenceFile}
                </span>
              </div>
            </div>
          </div>

          <div className="monument-shadow" />
          <VazoraMonument
            state={STATES[step]}
            playing={playback.playing}
            step={step}
            duration={HERO_DURATIONS[step]}
            mirrored={locale === "ar"}
            onReady={handleReady}
          />

          {/* Elegant side narrative — the current step, beside the letter */}
          <div className="monument-narrative" key={step} data-active>
            <span className="narrative-index" dir="ltr">{String(step + 1).padStart(2, "0")}</span>
            <div>
              <h3>{steps[step].title}</h3>
              <p>{steps[step].body}</p>
            </div>
          </div>

          {/* Unified Verification Dock (High-Tech Instrument Capsule) */}
          <div className="monument-verdict">
            <div className="monument-dock">
              <div className="dock-factor" data-status={step >= 5 ? "verified" : step === 4 ? "checking" : "pending"}>
                <span className="dock-indicator">
                  {step >= 5 ? <Check size={13} strokeWidth={2.5} /> : <span className="dock-dot" />}
                </span>
                <span className="dock-text">{t("period")}</span>
              </div>
              <span className="dock-separator" aria-hidden="true" />
              <div className="dock-factor" data-status={verified ? "verified" : step >= 7 ? "checking" : step >= 5 ? "missing" : "pending"}>
                <span className="dock-indicator">
                  {verified ? <Check size={13} strokeWidth={2.5} /> : <span className="dock-dot" />}
                </span>
                <span className="dock-text">{t("ack")}</span>
              </div>
            </div>

            <div className="monument-status-line">
              <span className="status-pill-indicator">
                {verified ? <Check size={14} strokeWidth={2.5} /> : <span className="status-gap-pulse" />}
              </span>
              <strong className="status-title">{common(`thread.${STATES[step]}`)}</strong>
            </div>
            <p className="status-subtext">
              {verified ? t("verified") : step === 5 || step === 6 ? `${t("ack")} · ${t("missing")}` : common("thread.open")}
            </p>
          </div>
        </div>
      </div>
      {/* threads */}
      <EvidenceEnvironment
        className="hero-environment"
        state={STATES[step]}
        detected={step >= 1}
        source={{
          reference: "RTA-OM-2026-014",
          clause: "8.4",
          excerpt: t("clauseText"),
          evidence: step < 3 ? null : evidenceFile,
        }}
      />
      {/* status strip */}
      <details className="hero-dossier">
      <summary className="system-caption">
        <span className="m-code" dir="ltr">
          VAZORA / CI—014
        </span>
        <span>{common("demo")}</span>
        <span className="m-code" dir="ltr">
          {String(step + 1).padStart(2, "0")} / 11
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="hero-scene">
        {/* document */}
        <div className="hero-source source-plane">
          <div className="source-heading">
            <FileText size={15} />
            <span>{t("source")}</span>
            <span className="m-code">01</span>
          </div>
          <h3>{t("sourceName")}</h3>
          <span className="m-code source-reference" dir="ltr">
            RTA-OM-2026-014
          </span>
          <div className="document-lines" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          {/* clause markers */}
          <div className={cn("source-clause", step >= 1 && "is-detected")}>
            <span className="m-code">§ 8.4</span>
            <p>{t("clauseText")}</p>
          </div>
          <div className="document-lines" aria-hidden>
            <i />
            <i />
          </div>
          <span className="source-page m-code" dir="ltr">
            08 / 36
          </span>
        </div>
        {/* obligations */}
        <div className="hero-core">
          <div className="requirement-heading">
            <span className="m-eyebrow">{t("requirement")}</span>
            <h3>{t("requirementText")}</h3>
            <span>{t("owner")}</span>
          </div>
          <EvidenceConvergence state={STATES[step]} />
          {/* officer */}
          <div
            className={cn("hero-action", step < 6 && "is-waiting")}
            data-action-resolved={impacted}
          >
            <span className="action-branch" aria-hidden />
            <div>
              <span className="m-eyebrow">{t("officer")}</span>
              <p>
                {t(
                  step < 6
                    ? "awaitAction"
                    : impacted
                      ? "actionDone"
                      : "request",
                )}
              </p>
            </div>
            <ArrowDown size={15} />
          </div>
        </div>
        {/* evidence */}
        <div
          className={cn("hero-evidence source-plane", step < 3 && "is-pending")}
        >
          <div className="source-heading">
            <FileText size={15} />
            <span>
              {t(step < 3 ? "expected" : step >= 7 ? "newFile" : "file")}
            </span>
            <span className="m-code">02</span>
          </div>
          <p className="evidence-file" dir="ltr">
            {evidenceFile}
          </p>
          <p className="evidence-file-note">{t("fileNote")}</p>
          <div className="evidence-preview" aria-hidden>
            <span className="m-code">SEP / 2026</span>
            <div className="document-lines">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="signature-line">
              {step >= 7 ? <span>F. Al-Harbi</span> : <span>—</span>}
            </div>
          </div>
          <div className="evidence-check">
            <span>{t("ack")}</span>
            <span className={verified ? "text-verified" : "text-partial"}>
              {verified ? (
                <Check size={16} />
              ) : (
                t(step >= 7 ? "pending" : "missing")
              )}
            </span>
          </div>
          <div className="evidence-note">
            {verified ? t("verified") : common(`thread.${STATES[step]}`)}
          </div>
        </div>
      </div>
      {/* missing → risk → officer → readiness causal thread */}
      <div className="hero-outcome" data-theme="dark">
        {/* risk */}
        <div>
          <span className="m-eyebrow">{t("risk")}</span>
          <strong
            data-risk={
              impacted ? "mitigated" : step >= 5 ? "open" : "unassessed"
            }
          >
            {t(impacted ? "mitigated" : step >= 5 ? "openRisk" : "unassessed")}
          </strong>
        </div>
        <span className="outcome-connection" aria-hidden />
        {/* readiness */}
        <div>
          <span className="m-eyebrow">{t("readiness")}</span>
          <strong
            className="outcome-number"
            dir="ltr"
            data-readiness={impacted ? 82 : 73}
          >
            {impacted ? "82" : "73"}
            <small>%</small>
          </strong>
        </div>
        <p>{t("impactNote")}</p>
      </div>
      </details>
      <div className="sequence-explanation">
        <div aria-live={playback.playing ? "off" : "polite"} className="sr-only">
          <h3>{steps[step].title}</h3>
          <p>{steps[step].body}</p>
        </div>
        <SequenceControls playback={playback} />
      </div>
    </div>
  );
}
