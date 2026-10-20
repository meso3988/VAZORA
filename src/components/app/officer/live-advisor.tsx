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

const MOUTH_SHAPES: Record<VisemeKind, { rx: number; ry: number; open: boolean; teeth?: boolean }> = {
  sil: { rx: 9, ry: 1.4, open: false },
  MBP: { rx: 8.5, ry: 1.1, open: false },
  FV: { rx: 9.5, ry: 2.6, open: true, teeth: true },
  EE: { rx: 11, ry: 3.4, open: true, teeth: true },
  AA: { rx: 10, ry: 6.2, open: true, teeth: true },
  OH: { rx: 7.2, ry: 5.8, open: true },
  OO: { rx: 5.4, ry: 4.5, open: true },
};

const CUE_TONE: Record<OfficerSpeechCue, { ring: string; badge: string; browLift: number; headTilt: number }> = {
  neutral: { ring: "border-emerald-600/40", badge: "bg-verified/10 text-verified border-verified/30", browLift: 0, headTilt: 0 },
  uncertainty: { ring: "border-amber-500/50", badge: "bg-partial/10 text-partial border-partial/30", browLift: -1.8, headTilt: -1.5 },
  approval_request: { ring: "border-sky-500/50", badge: "bg-fg/8 text-fg border-line", browLift: -1, headTilt: 1.2 },
  critical: { ring: "border-rose-500/60", badge: "bg-missing/10 text-missing border-missing/30", browLift: 1.6, headTilt: 0 },
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
  const [blink, setBlink] = useState(false);
  const [muted, setMuted] = useState(false);
  const [question, setQuestion] = useState("");
  const [replyText, setReplyText] = useState<string>(
    defaultVoice === "ar-SA" ? labels.greetingAr : labels.greetingEnUs,
  );
  const [citations, setCitations] = useState<OfficerCitation[]>([]);
  const [tools, setTools] = useState<OfficerToolInvocation[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const visemeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const recognitionRef = useRef<any>(null);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Natural blinking cycle (paused when prefers-reduced-motion is enabled).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
    }, 3800);
    return () => clearInterval(id);
  }, []);

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

  const animateVisemes = (seq: VisemeKind[], spokenText: string, vLocale: AdvisorVoiceLocale) => {
    stopSpeech();
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
        utter.pitch = 1.04;
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
        // Viseme timeline continues as visual fallback if browser TTS is unavailable.
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
      animateVisemes(
        Array.isArray(data.visemes) && data.visemes.length ? data.visemes : ["AA", "EE", "OH", "sil"],
        data.spokenText ?? data.answer?.text ?? "",
        targetLocale,
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

  const mouth = MOUTH_SHAPES[viseme] ?? MOUTH_SHAPES.sil;
  const tone = CUE_TONE[cue] ?? CUE_TONE.neutral;
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
      className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[240px_minmax(0,1fr)]"
    >
      {/* ===== Left: Animated Female Executive Contract Advisor Avatar ===== */}
      <div className="flex flex-col items-center gap-3 rounded-md border border-line bg-bg/70 p-4">
        <div
          className={cn(
            "relative flex h-44 w-44 items-center justify-center rounded-full border-2 bg-elevated shadow-inner transition-all duration-300",
            tone.ring,
            status === "speaking" && "ring-4 ring-emerald-500/15",
            status === "listening" && "ring-4 ring-sky-500/20",
          )}
        >
          <svg
            viewBox="0 0 200 210"
            className="h-40 w-40 overflow-visible"
            role="img"
            aria-label={`${labels.name} — ${labels.role}`}
          >
            <defs>
              <linearGradient id="vazora-bg-halo" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#14342B" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#8B6F3D" stopOpacity="0.10" />
              </linearGradient>
              <linearGradient id="vazora-skin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F2D7C4" />
                <stop offset="100%" stopColor="#E4BE9E" />
              </linearGradient>
              <linearGradient id="vazora-hair" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1E1B1A" />
                <stop offset="100%" stopColor="#352B26" />
              </linearGradient>
              <linearGradient id="vazora-blazer" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1B2826" />
                <stop offset="100%" stopColor="#0F1716" />
              </linearGradient>
            </defs>

            {/* Subtle mineral studio backdrop */}
            <circle cx="100" cy="104" r="88" fill="url(#vazora-bg-halo)" />

            {/* Back hair */}
            <path
              d="M52 78 C46 118, 50 156, 60 174 L140 174 C150 156, 154 118, 148 78 C144 42, 126 28, 100 28 C74 28, 56 42, 52 78 Z"
              fill="url(#vazora-hair)"
            />

            {/* Neck & silk blouse + tailored executive blazer */}
            <rect x="86" y="132" width="28" height="26" rx="8" fill="#DFB697" />
            <path d="M40 198 C44 158, 68 148, 100 148 C132 148, 156 158, 160 198 Z" fill="url(#vazora-blazer)" />
            {/* Silk ivory V-neck blouse */}
            <polygon points="84,148 116,148 100,184" fill="#F6F2EA" />
            {/* Tailored blazer lapels */}
            <polygon points="72,150 86,148 100,184 82,196" fill="#243532" />
            <polygon points="128,150 114,148 100,184 118,196" fill="#243532" />
            {/* Gold & emerald VAZORA lapel pin */}
            <circle cx="122" cy="172" r="3.4" fill="#C6A15B" />
            <circle cx="122" cy="172" r="1.6" fill="#1F7A5A" />

            {/* Animated head group (responds to OfficerSpeechCue + speaking cadence) */}
            <g
              transform={`translate(0, ${status === "speaking" ? -1.2 : 0}) rotate(${tone.headTilt}, 100, 96)`}
            >
              {/* Ears & pearl studs */}
              <ellipse cx="59" cy="96" rx="5" ry="9" fill="#E4BE9E" />
              <ellipse cx="141" cy="96" rx="5" ry="9" fill="#E4BE9E" />
              <circle cx="59" cy="104" r="2.1" fill="#F7F3EB" stroke="#C6A15B" strokeWidth="0.7" />
              <circle cx="141" cy="104" r="2.1" fill="#F7F3EB" stroke="#C6A15B" strokeWidth="0.7" />

              {/* Face contour */}
              <path
                d="M62 76 C62 49, 78 38, 100 38 C122 38, 138 49, 138 76 C138 108, 122 136, 100 138 C78 136, 62 108, 62 76 Z"
                fill="url(#vazora-skin)"
              />

              {/* Professional side-parted hair */}
              <path
                d="M59 84 C58 54, 75 34, 104 34 C126 34, 141 50, 141 80 C134 62, 118 54, 94 56 C76 58, 65 68, 59 84 Z"
                fill="url(#vazora-hair)"
              />

              {/* Eyebrows (shift slightly with cue) */}
              <path
                d={`M72 ${76 + tone.browLift} Q82 ${72 + tone.browLift} 91 ${75 + tone.browLift}`}
                stroke="#2B221E"
                strokeWidth="2.3"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d={`M109 ${75 + tone.browLift} Q118 ${72 + tone.browLift} 128 ${76 + tone.browLift}`}
                stroke="#2B221E"
                strokeWidth="2.3"
                strokeLinecap="round"
                fill="none"
              />

              {/* Eyes (blink cycle) */}
              {blink ? (
                <>
                  <path d="M74 86 Q82 88 90 86" stroke="#2B221E" strokeWidth="2" strokeLinecap="round" fill="none" />
                  <path d="M110 86 Q118 88 126 86" stroke="#2B221E" strokeWidth="2" strokeLinecap="round" fill="none" />
                </>
              ) : (
                <>
                  <ellipse cx="82" cy="86" rx="7.2" ry="4.4" fill="#FFFFFF" />
                  <circle cx="82" cy="86" r="3.2" fill="#3B2B23" />
                  <circle cx="83.2" cy="84.8" r="1" fill="#FFFFFF" />
                  <path d="M74 84 Q82 80 90 84" stroke="#2B221E" strokeWidth="1.6" fill="none" />

                  <ellipse cx="118" cy="86" rx="7.2" ry="4.4" fill="#FFFFFF" />
                  <circle cx="118" cy="86" r="3.2" fill="#3B2B23" />
                  <circle cx="119.2" cy="84.8" r="1" fill="#FFFFFF" />
                  <path d="M110 84 Q118 80 126 84" stroke="#2B221E" strokeWidth="1.6" fill="none" />
                </>
              )}

              {/* Subtle nose bridge */}
              <path d="M100 84 L98 102 Q100 104 103 102" stroke="#C99E80" strokeWidth="1.5" strokeLinecap="round" fill="none" />

              {/* Multi-viseme lip-synced mouth */}
              <g data-advisor-mouth={viseme} transform="translate(100, 117)">
                {mouth.open ? (
                  <>
                    <ellipse cx="0" cy="0" rx={mouth.rx} ry={mouth.ry} fill="#6E242B" stroke="#B65D61" strokeWidth="1.5" />
                    {mouth.teeth && (
                      <rect x={-mouth.rx * 0.65} y={-mouth.ry * 0.75} width={mouth.rx * 1.3} height={Math.min(2.4, mouth.ry * 0.55)} rx="0.8" fill="#FAF6F0" />
                    )}
                  </>
                ) : (
                  <path
                    d={`M-${mouth.rx} 0 Q0 ${mouth.ry * 1.4} ${mouth.rx} 0`}
                    stroke="#B05559"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    fill="none"
                  />
                )}
              </g>
            </g>
          </svg>
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
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
        </div>
      </div>

      {/* ===== Right: Voice/Accent Selector, Grounded Spoken Output, and Controls ===== */}
      <div className="flex flex-col justify-between gap-4">
        {/* Top bar: EN-US / EN-GB / AR-SA selector + cost badge + audio controls */}
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
