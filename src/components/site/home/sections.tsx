import { ArrowRight, Check, FileText, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { ThreadLine } from "@/components/brand/threads";
import { Reveal } from "@/components/motion/reveal";
import { ActivityStream } from "@/components/site/activity-stream";
import { AssessorEcosystem } from "@/components/site/assessor-ecosystem";
import { ProofChain } from "@/components/site/proof-chain";
import { ButtonLink } from "@/components/ui/button";
import { StatusDot, type StatusTone } from "@/components/ui/status";
import { Eyebrow, SectionHeading } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- */
/* Problem — editorial, no cards                                      */
/* ---------------------------------------------------------------- */

export function Problem() {
  const t = useTranslations("home.problem");
  const points = t.raw("points") as { title: string; body: string }[];
  return (
    <section className="bg-subtle">
      <div className="container-x grid grid-cols-1 gap-12 py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <ol className="flex flex-col">
          {points.map((p, i) => (
            <Reveal
              key={p.title}
              delay={i * 0.08}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 border-t border-line-strong/60 py-7 last:border-b"
            >
              <span className="pt-1 font-mono text-xs text-faint">0{i + 1}</span>
              <div className="flex flex-col gap-2">
                <h3 className="text-xl font-medium">{p.title}</h3>
                <p className="max-w-[52ch] text-[15px] leading-relaxed text-muted">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Shift — the Proof Chain                                            */
/* ---------------------------------------------------------------- */

export function Shift() {
  const t = useTranslations("home.shift");
  return (
    <section className="bg-canvas">
      <div className="container-x flex flex-col gap-16 py-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} align="center" className="mx-auto" />
        </Reveal>
        <Reveal>
          <ProofChain className="mx-auto w-full max-w-5xl" />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Lifecycle — one thread from award to closeout                      */
/* ---------------------------------------------------------------- */

export function Lifecycle() {
  const t = useTranslations("home.lifecycle");
  const stages = t.raw("stages") as { label: string; hint: string }[];
  const n = stages.length;
  return (
    <section>
      <div className="container-x flex flex-col gap-14 py-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <Reveal>
          <div className="relative">
            <ThreadLine inset={100 / n / 2} className="absolute inset-x-0 top-[0.8rem] hidden h-0.5 w-full lg:block" />
            <ol className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:grid-cols-8">
              {stages.map((s, i) => (
                <li key={s.label} className="relative flex flex-col gap-3 lg:items-center lg:text-center">
                  <span
                    className={cn(
                      "relative z-10 flex size-7 items-center justify-center rounded-full border bg-bg font-mono text-[11px]",
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
/* Evidence quality — floating verification interface                 */
/* ---------------------------------------------------------------- */

export function EvidenceQuality() {
  const t = useTranslations("home.evidence");
  const checks = t.raw("checks") as { label: string; passed: boolean; note?: string }[];
  return (
    <section className="bg-subtle">
      <div className="container-x grid grid-cols-1 items-center gap-12 py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <Reveal className="min-w-0">
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <div className="surface-float overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <span className="flex size-9 items-center justify-center rounded-md bg-subtle text-muted">
                <FileText size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{t("fileLabel")}</p>
                <p className="truncate font-mono text-sm" dir="ltr">
                  Performance_Sep.pdf
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
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                      c.passed ? "bg-verified/12 text-verified" : "bg-missing/12 text-missing",
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
            <div className="flex items-center gap-2 border-t border-line bg-subtle/60 px-5 py-3.5 text-sm">
              <StatusDot tone="partial" />
              <span className="text-partial">{t("verdict")}</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* AI Contract Officer — the immersive dark moment                    */
/* ---------------------------------------------------------------- */

export function Officer() {
  const t = useTranslations("home.officer");
  return (
    <section data-theme="dark" className="relative overflow-hidden bg-bg text-fg">
      <div className="container-x grid grid-cols-1 items-center gap-14 py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <ActivityStream />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Claim readiness — large financial moment                           */
/* ---------------------------------------------------------------- */

export function ClaimReadiness() {
  const t = useTranslations("home.claim");
  const reasons = t.raw("reasons") as { text: string; effect: string; tone: StatusTone }[];
  const counts = { verified: 9, partial: 2, missing: 1 } as const;
  const total = counts.verified + counts.partial + counts.missing;
  const readiness = 82;
  const cells: StatusTone[] = [
    ...Array<StatusTone>(counts.verified).fill("verified"),
    ...Array<StatusTone>(counts.partial).fill("partial"),
    ...Array<StatusTone>(counts.missing).fill("missing"),
  ];

  return (
    <section className="bg-canvas">
      <div className="container-x flex flex-col gap-16 py-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} className="max-w-3xl" />
        </Reveal>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20">
          <Reveal className="flex flex-col gap-10">
            <p className="font-mono text-xs text-faint">{t("claimLabel")}</p>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Eyebrow>{t("valueLabel")}</Eyebrow>
                <p className="display tabular text-nowrap text-[2.25rem] leading-none sm:text-[2.75rem] lg:text-[3.25rem]" dir="ltr">
                  {t("amount")}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Eyebrow>{t("readinessLabel")}</Eyebrow>
                <p className="display tabular text-[2.5rem] leading-none text-partial sm:text-[3.25rem]" dir="ltr">
                  {readiness}%
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-subtle" dir="ltr">
                <span className="bg-verified" style={{ width: `${(counts.verified / total) * 100}%` }} />
                <span className="bg-partial" style={{ width: `${(counts.partial / total) * 100}%` }} />
                <span className="bg-missing" style={{ width: `${(counts.missing / total) * 100}%` }} />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
                <span className="text-fg">{t("requirements", { count: total })}</span>
                <span className="flex items-center gap-2">
                  <StatusDot tone="verified" /> {t("verified", { count: counts.verified })}
                </span>
                <span className="flex items-center gap-2">
                  <StatusDot tone="partial" /> {t("partial", { count: counts.partial })}
                </span>
                <span className="flex items-center gap-2">
                  <StatusDot tone="missing" /> {t("missing", { count: counts.missing })}
                </span>
              </div>
            </div>
            <ul className="grid grid-cols-6 gap-2 sm:grid-cols-12" aria-hidden>
              {cells.map((tone, i) => (
                <li
                  key={i}
                  className={cn(
                    "h-10 rounded-sm border",
                    tone === "verified" && "border-verified/30 bg-verified/10",
                    tone === "partial" && "border-partial/40 bg-partial/10",
                    tone === "missing" && "border-dashed border-missing/50 bg-missing/5",
                  )}
                />
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.1} className="flex flex-col gap-6 border-t border-line pt-8 lg:border-t-0 lg:border-s lg:ps-12 lg:pt-0">
            <Eyebrow>{t("why")}</Eyebrow>
            <ul className="flex flex-col gap-6">
              {reasons.map((r) => (
                <li key={r.text} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                  <StatusDot tone={r.tone} className="mt-2" />
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-medium">{r.text}</span>
                    <span className="flex items-center gap-2 text-sm text-muted">
                      <ArrowRight size={14} className="text-faint rtl:-scale-x-100" />
                      {r.effect}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Assessor intro — ecosystem + provider portfolio                    */
/* ---------------------------------------------------------------- */

export function AssessorIntro() {
  const t = useTranslations("home.assessor");
  const portfolio = t.raw("portfolio") as { label: string; value: string }[];
  return (
    <section className="bg-subtle">
      <div className="container-x flex flex-col gap-16 py-24">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <Reveal className="flex flex-col gap-8">
            <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={t("body")} />
            <div>
              <ButtonLink href="/assessor" variant="secondary">
                {t("cta")}
                <ArrowRight size={16} className="rtl:-scale-x-100" />
              </ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <AssessorEcosystem />
          </Reveal>
        </div>

        <Reveal className="flex flex-col gap-6 border-t border-line-strong/60 pt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Eyebrow>{t("portfolioTitle")}</Eyebrow>
            <span className="font-mono text-[11px] text-faint">{t("portfolioHint")}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-5">
            {portfolio.map((p) => (
              <div key={p.label} className="flex flex-col gap-1">
                <dd className="display tabular text-[2rem] leading-none sm:text-[2.5rem]" dir="ltr">
                  {p.value}
                </dd>
                <dt className="text-xs text-muted">{p.label}</dt>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">{t("model")}</p>
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
    <section>
      <div className="container-x flex flex-col gap-12 py-24">
        <Reveal>
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
        </Reveal>
        <dl className="grid grid-cols-1 gap-x-10 gap-y-0 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal key={it.title} delay={i * 0.06} className="flex flex-col gap-2 border-t border-line-strong/60 py-6">
              <dt className="text-base font-medium">{it.title}</dt>
              <dd className="text-sm leading-relaxed text-muted">{it.body}</dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Final CTA                                                          */
/* ---------------------------------------------------------------- */

export function FinalCta() {
  const t = useTranslations("home.cta");
  return (
    <section className="bg-subtle">
      <div className="container-x py-24">
        <Reveal className="grid grid-cols-1 items-end gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex flex-col gap-4">
            <h2 className="display statement max-w-[20ch] text-balance text-[2rem] sm:text-[2.625rem]">{t("title")}</h2>
            <p className="text-base text-muted sm:text-lg">{t("body")}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
            <ButtonLink href="/demo" size="lg">
              {t("primary")}
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="lg">
              {t("secondary")}
            </ButtonLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
