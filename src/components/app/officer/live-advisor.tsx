"use client";

import { Mic, MicOff, Send, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { OfficerCitation, OfficerToolInvocation } from "@/domain/officer";
import { Link } from "@/i18n/navigation";
import type { OfficerSpeechCue } from "@/lib/officer/realtime-contract";
import { cn } from "@/lib/utils";

export type AdvisorVoiceLocale = "en-US" | "en-GB" | "ar-SA";
type VisemeKind = "sil" | "AA" | "EE" | "OH" | "OO" | "FV" | "MBP";

type Labels = {
  badge: string;
  name: string;
  role: string;
  costBadge: string;
  voiceLabel: string;
  voices: Record<AdvisorVoiceLocale, string>;
  cues: Record<OfficerSpeechCue, string>;
  states: { idle: string; listening: string; thinking: string; speaking: string };
  micStart: string;
  micStop: string;
  bargeIn: string;
  mute: string;
  unmute: string;
  placeholder: string;
  ask: string;
  quickSummary: string;
  quickOverdue: string;
  quickGaps: string;
  toolsUsed: string;
  citationsLabel: string;
  greetingEnUs: string;
  greetingEnGb: string;
  greetingAr: string;
};

const CUE_TONE: Record<OfficerSpeechCue, { ring: string; badge: string; tilt: string }> = {
  neutral: { ring: "border-emerald-600/40", badge: "bg-verified/10 text-verified border-verified/30", tilt: "rotate-0" },
  uncertainty: { ring: "border-amber-500/50", badge: "bg-partial/10 text-partial border-partial/30", tilt: "-rotate-1" },
  approval_request: { ring: "border-sky-500/50", badge: "bg-fg/8 text-fg border-line", tilt: "rotate-1" },
  critical: { ring: "border-rose-500/60", badge: "bg-missing/10 text-missing border-missing/30", tilt: "rotate-0" },
};

const VISEME_BAR_HEIGHTS: Record<VisemeKind, [number, number, number, number, number]> = {
  sil: [3, 4, 3, 4, 3],
  MBP: [5, 7, 6, 7, 5],
  FV: [7, 11, 9, 11, 7],
  EE: [9, 14, 12, 14, 9],
  AA: [12, 18, 22, 18, 12],
  OH: [10, 16, 20, 16, 10],
  OO: [8, 13, 16, 13, 8],
};

function pickPreferredFemaleVoice(
  voices: SpeechSynthesisVoice[],
  target: AdvisorVoiceLocale,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const langPrefix = target.toLowerCase();
  const baseLang = langPrefix.split("-")[0];
  const femaleHints = /samantha|victoria|allison|ava|serena|kate|martha|stephanie|libby|sonia|maisie|zoe|laila|mariam|salma|hoda|fatima|amira|female|woman/i;

  const exactFemale = voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(langPrefix) && femaleHints.test(v.name));
  if (exactFemale) return exactFemale;

  const exactLocale = voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(langPrefix));
  if (exactLocale) return exactLocale;

  const baseFemale = voices.find((v) => v.lang.toLowerCase().startsWith(baseLang) && femaleHints.test(v.name));
  if (baseFemale) return baseFemale;

  return voices.find((v) => v.lang.toLowerCase().startsWith(baseLang)) ?? null;
}

export function LiveAdvisor({
  locale,
  conversationId,
  contractId,
  initialCue = "neutral",
  labels,
}: {
  locale: string;
  conversationId?: string | null;
  contractId?: string | null;
  initialCue?: OfficerSpeechCue;
  labels: Labels;
}) {
  const defaultVoice: AdvisorVoiceLocale = locale.startsWith("ar") ? "ar-SA" : "en-US";
  const [voiceLocale, setVoiceLocale] = useState<AdvisorVoiceLocale>(defaultVoice);
  const [cue, setCue] = useState<OfficerSpeechCue>(initialCue);
  const [status, setStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [viseme, setViseme] = useState<VisemeKind>("sil");
  const [muted, setMuted] = useState(false);
  const [question, setQuestion] = useState("");
  const [replyText, setReplyText] = useState<string>(
    defaultVoice === "ar-SA" ? labels.greetingAr : labels.greetingEnUs,
  );
  const [citations, setCitations] = useState<OfficerCitation[]>([]);
  const [tools, setTools] = useState<OfficerToolInvocation[]>([]);
  const [turnaroundMs, setTurnaroundMs] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const visemeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const recognitionRef = useRef<any>(null);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const stopSpeech = () => {
    if (visemeTimerRef.current) {
      clearInterval(visemeTimerRef.current);
      visemeTimerRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setViseme("sil");
    setStatus((s) => (s === "speaking" ? "idle" : s));
  };

  useEffect(() => () => stopSpeech(), []);

  const animateCadenceAndSpeak = (
    seq: VisemeKind[],
    spokenText: string,
    vLocale: AdvisorVoiceLocale,
    serverDurationMs: number | null,
  ) => {
    stopSpeech();
    if (serverDurationMs !== null) setTurnaroundMs(Math.max(1, Math.round(serverDurationMs)));
    if (!seq.length) return;
    setStatus("speaking");
    let idx = 0;
    visemeTimerRef.current = setInterval(() => {
      setViseme(seq[idx % seq.length] ?? "sil");
      idx++;
      if (idx >= seq.length) {
        if (visemeTimerRef.current) clearInterval(visemeTimerRef.current);
        visemeTimerRef.current = null;
        setViseme("sil");
        setStatus("idle");
      }
    }, 115);

    if (!muted && typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        const utter = new SpeechSynthesisUtterance(spokenText);
        utter.lang = vLocale;
        utter.rate = vLocale === "ar-SA" ? 0.98 : 1.0;
        utter.pitch = 1.02;
        const chosen = pickPreferredFemaleVoice(window.speechSynthesis.getVoices(), vLocale);
        if (chosen) utter.voice = chosen;
        utter.onend = () => {
          if (visemeTimerRef.current) clearInterval(visemeTimerRef.current);
          visemeTimerRef.current = null;
          setViseme("sil");
          setStatus("idle");
        };
        utter.onerror = () => {
          if (visemeTimerRef.current) clearInterval(visemeTimerRef.current);
          visemeTimerRef.current = null;
          setViseme("sil");
          setStatus("idle");
        };
        window.speechSynthesis.speak(utter);
      } catch {
        // Browser speech synthesis is optional in headless environments.
      }
    }
  };

  const submitQuestion = async (qText: string, targetLocale: AdvisorVoiceLocale = voiceLocale) => {
    const trimmed = qText.trim();
    if (!trimmed) return;
    stopSpeech();
    setErrorMsg(null);
    setStatus("thinking");
    try {
      const res = await fetch("/api/officer/realtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "ask",
          question: trimmed,
          conversationId: conversationId ?? null,
          contractId: contractId ?? null,
          voiceLocale: targetLocale,
          mode: "rehearsal",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setErrorMsg(data?.message ?? "Request failed");
        setStatus("idle");
        return;
      }
      setReplyText(data.answer?.text ?? data.spokenText ?? "");
      setCue((data.speechCue as OfficerSpeechCue) ?? "neutral");
      setCitations(Array.isArray(data.citations) ? data.citations : []);
      setTools(Array.isArray(data.answer?.toolInvocations) ? data.answer.toolInvocations : []);
      animateCadenceAndSpeak(
        Array.isArray(data.visemes) && data.visemes.length ? data.visemes : ["AA", "EE", "OH", "sil"],
        data.spokenText ?? data.answer?.text ?? "",
        targetLocale,
        typeof data.answer?.durationMs === "number" ? data.answer.durationMs : null,
      );
    } catch {
      setErrorMsg("Unable to reach the Contract Advisor endpoint.");
      setStatus("idle");
    }
  };

  const toggleMic = () => {
    if (status === "listening" && recognitionRef.current) {
      recognitionRef.current.stop();
      setStatus("idle");
      return;
    }
    stopSpeech();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const SpeechRec = typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
    if (!SpeechRec) {
      setErrorMsg(
        voiceLocale === "ar-SA"
          ? "الإدخال الصوتي المباشر غير مدعوم في هذا المتصفح؛ يمكنكِ استخدام الأزرار السريعة أو الكتابة أدناه."
          : "Browser microphone recognition is unavailable here; use the quick voice prompts or type below.",
      );
      return;
    }
    const rec = new SpeechRec();
    rec.lang = voiceLocale;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setStatus("listening");
    rec.onresult = (ev: any) => {
      const transcript = ev?.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setQuestion(transcript);
        void submitQuestion(transcript, voiceLocale);
      }
    };
    rec.onerror = () => setStatus("idle");
    rec.onend = () => setStatus((s) => (s === "listening" ? "idle" : s));
    recognitionRef.current = rec;
    rec.start();
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };

  const handleVoiceLocaleChange = (next: AdvisorVoiceLocale) => {
    stopSpeech();
    setVoiceLocale(next);
    if (!tools.length) {
      setReplyText(
        next === "ar-SA"
          ? labels.greetingAr
          : next === "en-GB"
            ? labels.greetingEnGb
            : labels.greetingEnUs,
      );
    }
  };

  const tone = CUE_TONE[cue] ?? CUE_TONE.neutral;
  const bars = VISEME_BAR_HEIGHTS[viseme] ?? VISEME_BAR_HEIGHTS.sil;
  const isArVoice = voiceLocale === "ar-SA";

  const quickPrompts = isArVoice
    ? [
        { label: labels.quickSummary, q: "أعطني ملخص العقود والالتزامات الحالية" },
        { label: labels.quickOverdue, q: "ما الالتزامات المتأخرة حاليًا؟" },
        { label: labels.quickGaps, q: "ما فجوات الأدلة المفتوحة؟" },
      ]
    : [
        { label: labels.quickSummary, q: "Give me the current contract and obligation summary." },
        { label: labels.quickOverdue, q: "Which obligations are currently overdue?" },
        { label: labels.quickGaps, q: "What open evidence gaps are recorded?" },
      ];

  return (
    <div
      data-live-advisor
      data-advisor-status={status}
      data-advisor-cue={cue}
      data-advisor-voice-locale={voiceLocale}
      data-advisor-viseme={viseme}
      className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[250px_minmax(0,1fr)]"
    >
      {/* ===== Left: Approved Reference Portrait of the VAZORA Contract Advisor ===== */}
      <div className="flex flex-col items-center gap-3 rounded-md border border-line bg-bg/70 p-4">
        <div
          className={cn(
            "relative h-52 w-44 overflow-hidden rounded-xl border-2 bg-elevated shadow-sm transition-all duration-300",
            tone.ring,
            tone.tilt,
            status === "speaking" && "ring-4 ring-emerald-500/20",
            status === "listening" && "ring-4 ring-sky-500/25",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/advisor/vazora-advisor-portrait.jpg"
            alt={`${labels.name} — ${labels.role}`}
            className={cn(
              "h-full w-full object-cover object-top transition-transform duration-300",
              status === "speaking" && "scale-[1.015]",
            )}
          />

          {/* Honest speaking-cadence wave overlay at the bottom of the portrait */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 py-2 text-white">
            <span className="text-[10px] font-medium opacity-90">
              {isArVoice ? "إيقاع النص (نموذج أولي)" : "Text cadence (prototype)"}
            </span>
            <div className="flex h-5 items-end gap-0.5" aria-hidden>
              {bars.map((h, i) => (
                <span
                  key={i}
                  style={{ height: `${h}px` }}
                  className="w-1 rounded-full bg-emerald-400 transition-all duration-100"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{labels.badge}</span>
          <p className="text-sm font-semibold text-fg">{labels.name}</p>
          <p className="text-[11px] text-muted">{labels.role}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-medium", tone.badge)}>
            {labels.cues[cue]}
          </span>
          <span className="rounded-full border border-line bg-elevated px-2.5 py-0.5 text-[10px] text-muted">
            {labels.states[status]}
          </span>
          {turnaroundMs !== null && (
            <span
              data-advisor-latency-ms={turnaroundMs}
              className="rounded-full border border-line bg-bg px-2 py-0.5 font-mono text-[10px] text-muted"
            >
              {turnaroundMs}ms
            </span>
          )}
        </div>
      </div>

      {/* ===== Right: Voice/Accent Selector, Grounded Spoken Output, and Controls ===== */}
      <div className="flex flex-col justify-between gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={labels.voiceLabel}>
            <span className="me-1 text-[11px] font-medium text-muted">{labels.voiceLabel}:</span>
            {(["en-US", "en-GB", "ar-SA"] as const).map((v) => (
              <button
                key={v}
                type="button"
                data-voice-option={v}
                onClick={() => handleVoiceLocaleChange(v)}
                className={cn(
                  "h-7 rounded-sm border px-2.5 text-xs font-medium transition-colors",
                  voiceLocale === v
                    ? "border-fg bg-fg text-bg"
                    : "border-line bg-elevated text-fg hover:bg-fg/5",
                )}
              >
                {labels.voices[v]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-verified/30 bg-verified/10 px-2 py-0.5 font-mono text-[10px] text-verified">
              {labels.costBadge}
            </span>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-elevated px-2 text-[11px] text-muted hover:text-fg"
              aria-label={muted ? labels.unmute : labels.mute}
            >
              {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              <span>{muted ? labels.unmute : labels.mute}</span>
            </button>
            {status === "speaking" && (
              <button
                type="button"
                data-advisor-barge-in
                onClick={stopSpeech}
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-missing/40 bg-missing/10 px-2.5 text-[11px] font-medium text-missing"
              >
                <Square size={11} />
                <span>{labels.bargeIn}</span>
              </button>
            )}
          </div>
        </div>

        {/* Advisor grounded response + tools executed + validated citations */}
        <div className="flex flex-col gap-2.5 rounded-md border border-line bg-elevated/60 p-4">
          <p
            data-advisor-reply
            dir={isArVoice ? "rtl" : "ltr"}
            className="text-sm leading-relaxed text-fg"
          >
            {replyText}
          </p>

          {tools.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2 text-[11px] text-muted">
              <span className="font-medium">{labels.toolsUsed}:</span>
              {tools.map((ti, idx) => (
                <span
                  key={`${ti.tool}-${idx}`}
                  data-advisor-tool={ti.tool}
                  className="rounded-sm border border-line bg-bg px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {ti.tool}
                </span>
              ))}
            </div>
          )}

          {citations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
              <span className="font-medium text-muted">{labels.citationsLabel}:</span>
              {citations.map((c) => {
                const href = c.href
                  ? c.href
                  : c.contractId
                    ? `/app/contracts/${c.contractId}`
                    : c.target === "contract"
                      ? `/app/contracts/${c.id}`
                      : "/app/contracts";
                return (
                  <Link
                    key={`${c.target}-${c.id}`}
                    href={href}
                    data-advisor-citation={`${c.target}:${c.id}`}
                    className="rounded-sm border border-line bg-bg px-2 py-0.5 text-[11px] text-fg underline decoration-line underline-offset-2 hover:border-fg"
                  >
                    {c.label}
                  </Link>
                );
              })}
            </div>
          )}

          {errorMsg && (
            <p role="alert" className="text-xs text-missing">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Quick grounded prompts */}
        <div className="flex flex-wrap items-center gap-1.5">
          {quickPrompts.map((qp) => (
            <button
              key={qp.label}
              type="button"
              data-advisor-quick={qp.label}
              disabled={status === "thinking"}
              onClick={() => {
                setQuestion(qp.q);
                void submitQuestion(qp.q, voiceLocale);
              }}
              className="rounded-full border border-line bg-elevated px-3 py-1 text-xs text-fg transition-colors hover:bg-fg/5 disabled:opacity-50"
            >
              {qp.label}
            </button>
          ))}
        </div>

        {/* Push-to-talk microphone + text question bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitQuestion(question, voiceLocale);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            data-advisor-mic
            onClick={toggleMic}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-sm border px-3 text-xs font-medium transition-colors",
              status === "listening"
                ? "border-missing bg-missing text-bg"
                : "border-line bg-elevated text-fg hover:bg-fg/5",
            )}
          >
            {status === "listening" ? <MicOff size={13} /> : <Mic size={13} />}
            <span>{status === "listening" ? labels.micStop : labels.micStart}</span>
          </button>

          <input
            type="text"
            name="advisorQuestion"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            className="h-9 min-w-0 flex-1 rounded-sm border border-line bg-bg px-3 text-xs text-fg"
          />

          <button
            type="submit"
            disabled={status === "thinking" || !question.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-fg px-3.5 text-xs font-medium text-bg hover:bg-fg/90 disabled:opacity-50"
          >
            <Send size={12} />
            <span>{labels.ask}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
