import { ArrowRight, Bell, Check, CircleDashed, Clock, FileText, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { ButtonLink } from "@/components/ui/button";
import { StatusDot, type StatusTone } from "@/components/ui/status";
import { Eyebrow, SectionHeading, Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- */
/* Problem                                                            */
/* ---------------------------------------------------------------- */

export function Problem() {
  const t = useTranslations("home.problem");
  const points = t.raw("points") as { title: string; body: string }[];
  return (
    <section className="border-t border-line">
      <div className="container-x grid grid-cols-1 gap-12 py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-20">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-1">
          {points.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08} className="flex flex-col gap-3 bg-bg p-6">
              <span className="font-mono text-xs text-faint">0{i + 1}</span>
              <h3 className="text-lg font-medium">{p.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{p.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Shift — evidence intelligence chain                                */
/* ---------------------------------------------------------------- */

export function Shift() {
  const t = useTranslations("home.shift");
  const chain = t.raw("chain") as string[];
  return (
    <section className="border-t border-line bg-elevated/40">
      <div className="container-x flex flex-col gap-14 py-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} align="center" className="mx-auto" />
        </Reveal>
        <Reveal>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-0">
            {chain.map((step, i) => (
              <li key={step} className="relative flex items-center">
                <div
                  className={cn(
                    "flex w-full flex-col gap-3 rounded-md border p-5",
                    i === chain.length - 1 ? "border-accent/50 bg-accent-soft" : "border-line bg-bg",
                  )}
                >
                  <span className="font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-sm font-medium">{step}</span>
                </div>
                {i < chain.length - 1 && (
                  <span
                    aria-hidden
                    className="hidden h-px w-6 shrink-0 bg-line-strong lg:block"
                  />
                )}
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Lifecycle                                                          */
/* ---------------------------------------------------------------- */

export function Lifecycle() {
  const t = useTranslations("home.lifecycle");
  const stages = t.raw("stages") as { label: string; hint: string }[];
  return (
    <section className="border-t border-line">
      <div className="container-x flex flex-col gap-14 py-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <Reveal>
          <div className="relative">
            <div aria-hidden className="absolute inset-x-0 top-[13px] hidden h-px bg-line lg:block" />
            <ol className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4 lg:grid-cols-8">
              {stages.map((s, i) => (
                <li key={s.label} className="relative flex flex-col gap-3">
                  <span
                    className={cn(
                      "relative z-10 flex size-7 items-center justify-center rounded-sm border bg-bg font-mono text-[11px]",
                      i === 0 ? "border-accent text-accent" : "border-line-strong text-muted",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-xs leading-relaxed text-muted">{s.hint}</span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Evidence quality                                                   */
/* ---------------------------------------------------------------- */

export function EvidenceQuality() {
  const t = useTranslations("home.evidence");
  const checks = t.raw("checks") as { label: string; passed: boolean; note?: string }[];
  return (
    <section className="border-t border-line bg-elevated/40">
      <div className="container-x grid grid-cols-1 items-center gap-12 py-24 lg:grid-cols-2 lg:gap-20">
        <Reveal className="min-w-0">
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <Surface className="overflow-hidden bg-bg">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <span className="flex size-9 items-center justify-center rounded-sm border border-line text-muted">
                <FileText size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{t("fileLabel")}</p>
                <p className="truncate font-mono text-sm" dir="ltr">
                  September Performance Report.pdf
                </p>
              </div>
              <span className="hidden font-mono text-xs text-faint sm:block">v2</span>
            </div>
            <p className="border-b border-line px-5 py-3 text-xs text-muted">{t("against")}</p>
            <ul className="divide-y divide-line">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3 px-5 py-3.5">
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm",
                      c.passed ? "bg-verified/15 text-verified" : "bg-missing/15 text-missing",
                    )}
                  >
                    {c.passed ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm">{c.label}</span>
                    {c.note && <span className="text-xs text-partial">{c.note}</span>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 border-t border-line bg-elevated px-5 py-3.5 text-sm">
              <StatusDot tone="partial" />
              <span className="text-partial">{t("verdict")}</span>
            </div>
          </Surface>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* AI Contract Officer                                                */
/* ---------------------------------------------------------------- */

const kindIcon = {
  attention: Bell,
  due_soon: Clock,
  claim_readiness: CircleDashed,
  verified: Check,
} as const;

const kindTone: Record<keyof typeof kindIcon, StatusTone> = {
  attention: "missing",
  due_soon: "at_risk",
  claim_readiness: "partial",
  verified: "verified",
};

export function Officer() {
  const t = useTranslations("home.officer");
  const feed = t.raw("feed") as { kind: keyof typeof kindIcon; text: string }[];
  return (
    <section className="border-t border-line">
      <div className="container-x grid grid-cols-1 items-center gap-12 py-24 lg:grid-cols-2 lg:gap-20">
        <Reveal className="lg:order-2">
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <Reveal delay={0.1} className="lg:order-1">
          <ul className="flex flex-col gap-3">
            {feed.map((f, i) => {
              const Icon = kindIcon[f.kind];
              const tone = kindTone[f.kind];
              return (
                <li
                  key={i}
                  className={cn(
                    "flex items-start gap-4 rounded-md border bg-elevated p-4",
                    i === 0 ? "border-missing/40" : "border-line",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm",
                      tone === "missing" && "bg-missing/15 text-missing",
                      tone === "at_risk" && "bg-at-risk/15 text-at-risk",
                      tone === "partial" && "bg-partial/15 text-partial",
                      tone === "verified" && "bg-verified/15 text-verified",
                    )}
                  >
                    <Icon size={15} />
                  </span>
                  <p className="text-sm leading-relaxed">{f.text}</p>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Claim readiness                                                    */
/* ---------------------------------------------------------------- */

const CLAIM_ITEMS: { tone: StatusTone; clause: string }[] = [
  ...Array.from({ length: 9 }, (_, i) => ({ tone: "verified" as const, clause: ["8.4", "8.4", "12.1", "14.2", "8.1", "8.2", "10.4", "10.6", "11.2"][i] })),
  { tone: "partial", clause: "12.1" },
  { tone: "partial", clause: "21.3" },
  { tone: "missing", clause: "14.2" },
];

export function ClaimReadiness() {
  const t = useTranslations("home.claim");
  const blocking = t.raw("blockingItems") as { clause: string; tone: StatusTone; text: string }[];
  const counts = { verified: 9, partial: 2, missing: 1 };
  const readiness = 82;
  return (
    <section className="border-t border-line bg-elevated/40">
      <div className="container-x grid grid-cols-1 items-center gap-12 py-24 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <Reveal delay={0.1}>
          <Surface className="bg-bg p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">{t("claimLabel")}</p>
                <p className="mt-1 font-mono text-2xl font-medium tabular">{t("amount")}</p>
              </div>
              <div className="text-end">
                <p className="eyebrow">{t("eyebrow")}</p>
                <p className="mt-1 font-mono text-4xl font-medium tabular text-verified">{readiness}%</p>
              </div>
            </div>
            <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-line">
              <div className="bg-verified" style={{ width: `${(counts.verified / 12) * 100}%` }} />
              <div className="bg-partial" style={{ width: `${(counts.partial / 12) * 100}%` }} />
              <div className="bg-missing" style={{ width: `${(counts.missing / 12) * 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
              <span className="flex items-center gap-1.5"><StatusDot tone="verified" />{t("verified", { count: counts.verified })}</span>
              <span className="flex items-center gap-1.5"><StatusDot tone="partial" />{t("partial", { count: counts.partial })}</span>
              <span className="flex items-center gap-1.5"><StatusDot tone="missing" />{t("missing", { count: counts.missing })}</span>
            </div>
            <div className="mt-6 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
              {CLAIM_ITEMS.map((c, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-sm border font-mono text-[10px]",
                    c.tone === "verified" && "border-verified/30 bg-verified/10 text-verified",
                    c.tone === "partial" && "border-partial/40 bg-partial/10 text-partial",
                    c.tone === "missing" && "border-missing/50 bg-missing/10 text-missing",
                  )}
                >
                  {c.clause}
                </span>
              ))}
            </div>
            <div className="mt-6 border-t border-line pt-5">
              <p className="eyebrow mb-3">{t("blocking")}</p>
              <ul className="flex flex-col gap-2 text-sm">
                {blocking.map((b) => (
                  <li key={b.clause + b.text} className="flex items-center gap-2">
                    <StatusDot tone={b.tone} />
                    <span className="font-mono text-xs text-faint">{b.clause}</span>
                    <span>{b.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Surface>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Assessor intro                                                     */
/* ---------------------------------------------------------------- */

export function AssessorIntro() {
  const t = useTranslations("home.assessor");
  const tracks = t.raw("tracks") as string[];
  return (
    <section className="border-t border-line">
      <div className="container-x grid grid-cols-1 gap-10 py-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-20">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
          <ButtonLink href="/assessor" variant="secondary" className="mt-8">
            {t("cta")}
            <ArrowRight size={16} className="rtl:-scale-x-100" />
          </ButtonLink>
        </Reveal>
        <Reveal delay={0.1}>
          <ul className="flex flex-wrap gap-2">
            {tracks.map((tr) => (
              <li key={tr} className="rounded-sm border border-line bg-elevated px-3 py-2 text-sm text-muted">
                {tr}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Trust                                                              */
/* ---------------------------------------------------------------- */

export function Trust() {
  const t = useTranslations("home.trust");
  const items = t.raw("items") as { title: string; body: string }[];
  return (
    <section className="border-t border-line bg-elevated/40">
      <div className="container-x flex flex-col gap-12 py-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
        </Reveal>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal key={it.title} delay={i * 0.06} className="flex flex-col gap-3 bg-bg p-6">
              <h3 className="text-base font-medium">{it.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{it.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* CTA                                                                */
/* ---------------------------------------------------------------- */

export function FinalCta() {
  const t = useTranslations("home.cta");
  return (
    <section className="border-t border-line">
      <div className="container-x py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-lg border border-line bg-elevated px-6 py-14 text-center sm:px-12">
            <div className="grid-bg pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
            <div className="relative flex flex-col items-center gap-6">
              <Eyebrow>VAZORA</Eyebrow>
              <h2 className="display max-w-[22ch] text-balance text-3xl font-medium sm:text-4xl">{t("title")}</h2>
              <p className="max-w-[48ch] text-muted">{t("body")}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/demo" size="lg">{t("primary")}</ButtonLink>
                <ButtonLink href="/login" variant="secondary" size="lg">{t("secondary")}</ButtonLink>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
