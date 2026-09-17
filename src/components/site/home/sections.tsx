import {
  ArrowRight,
  Fingerprint,
  GitBranch,
  LockKeyhole,
  UserCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { EvidenceConvergence } from "@/components/brand/threads";
import { ActivityStream } from "@/components/site/activity-stream";
import { AssessorEcosystem } from "@/components/site/assessor-ecosystem";
import { ClaimCanvas } from "@/components/site/claim-readiness";
import { ProofChain } from "@/components/site/proof-chain";
import { ButtonLink } from "@/components/ui/button";
import { ChapterFrame, ChapterLabel } from "@/components/ui/surface";

/* ---------------------------------------------------------------- */
/* Shared editorial chapter heading                                  */
/* ---------------------------------------------------------------- */

export function ChapterHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className={`chapter-heading${body ? "" : " chapter-heading-statement"}`}>
      <ChapterLabel label={eyebrow} />
      <h2 className="m-heading">{title}</h2>
      {body && <p>{body}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Shift — the Proof Chain                                            */
/* ---------------------------------------------------------------- */

export function Shift() {
  const t = useTranslations("mineral.proof");
  return (
    <section className="m-chapter proof-chapter" id="proof-chain">
      <ChapterFrame>
        <ChapterHeading
          eyebrow={t("eyebrow")}
          title={t("title")}
          body={t("body")}
        />
        <ProofChain />
      </ChapterFrame>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Lifecycle — one thread from award to closeout                      */
/* ---------------------------------------------------------------- */

export function Lifecycle() {
  const t = useTranslations("home.lifecycle");
  const stages = t.raw("stages") as { label: string; hint: string }[];
  return (
    <section className="product-lifecycle">
      <ChapterFrame>
        <ol className="lifecycle-path">
          {stages.map((s, i) => (
            <li key={s.label}>
              <span className="m-code">0{i + 1}</span>
              <strong>{s.label}</strong>
              <p>{s.hint}</p>
            </li>
          ))}
        </ol>
      </ChapterFrame>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* One engine — the same relationship across two product families     */
/* ---------------------------------------------------------------- */

export function OneEngine() {
  const t = useTranslations("mineral.engine");
  return (
    <section className="engine-chapter" id="evidence-engine">
      <ChapterFrame>
        <ChapterHeading eyebrow={t("eyebrow")} title={t("title")} />
        <div className="engine-composition">
          <div className="engine-product">
            <h3>{t("contract")}</h3>
            <p>{t("contractBody")}</p>
          </div>
          <EvidenceConvergence state="unverified" compact />
          <div className="engine-product">
            <h3>{t("assessor")}</h3>
            <p>{t("assessorBody")}</p>
          </div>
        </div>
        <div className="engine-principle">
          <span>{t("result")}</span>
          <p>{t("body")}</p>
        </div>
      </ChapterFrame>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* AI Contract Officer — the immersive dark moment                    */
/* ---------------------------------------------------------------- */

export function Officer() {
  const t = useTranslations("mineral.officer");
  return (
    <section data-theme="dark" className="officer-chapter" id="officer">
      <ChapterFrame>
        <ChapterHeading
          eyebrow={t("eyebrow")}
          title={t("title")}
          body={t("body")}
        />
        <ActivityStream />
      </ChapterFrame>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Claim readiness — large financial moment                           */
/* ---------------------------------------------------------------- */

export function ClaimReadiness() {
  const t = useTranslations("mineral.claim");
  return (
    <section className="m-chapter claim-chapter" id="claim-readiness">
      <ChapterFrame>
        <ChapterHeading eyebrow={t("eyebrow")} title={t("title")} />
        <ClaimCanvas />
      </ChapterFrame>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Assessor intro — ecosystem + provider portfolio                    */
/* ---------------------------------------------------------------- */

export function ProviderVision() {
  const t = useTranslations("mineral.assessor");
  const portfolio = t.raw("portfolio") as { value: string; label: string }[];
  const flow = t.raw("providerFlow") as string[];
  return (
    <div className="provider-vision">
      <div className="provider-heading">
        <h3>{t("providerTitle")}</h3>
        <span>{t("providerHint")}</span>
      </div>
      <dl className="provider-metrics">
        {portfolio.map((p) => (
          <div key={p.label}>
            <dd dir="ltr">{p.value}</dd>
            <dt>{p.label}</dt>
          </div>
        ))}
      </dl>
      <p className="provider-flow">
        {flow.map((step, i) => (
          <span key={step}>
            {i > 0 && <ArrowRight size={14} className="rtl:-scale-x-100" />}
            {step}
          </span>
        ))}
      </p>
    </div>
  );
}

export function AssessorIntro() {
  const t = useTranslations("mineral.assessor");
  return (
    <section className="m-chapter assessor-chapter" id="assessor-intelligence">
      <ChapterFrame>
        <ChapterHeading
          eyebrow={t("eyebrow")}
          title={t("title")}
          body={t("body")}
        />
        <AssessorEcosystem />
        <div className="chapter-action">
          <ButtonLink href="/assessor" variant="secondary">
            {t("cta")}
            <ArrowRight size={15} className="rtl:-scale-x-100" />
          </ButtonLink>
        </div>
        <ProviderVision />
      </ChapterFrame>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Trust                                                              */
/* ---------------------------------------------------------------- */

export function Trust() {
  const t = useTranslations("mineral.trust");
  const items = t.raw("items") as { title: string; body: string }[];
  const icons = [LockKeyhole, GitBranch, UserCheck, Fingerprint];
  return (
    <section className="trust-chapter" id="enterprise-trust">
      <ChapterFrame>
        <ChapterHeading
          eyebrow={t("eyebrow")}
          title={t("title")}
          body={t("body")}
        />
        <dl className="trust-register">
          {items.map((item, i) => {
            const Icon = icons[i];
            return (
              <div key={item.title}>
                <Icon size={20} strokeWidth={1.3} />
                <dt>{item.title}</dt>
                <dd>{item.body}</dd>
              </div>
            );
          })}
        </dl>
      </ChapterFrame>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Final CTA                                                          */
/* ---------------------------------------------------------------- */

export function FinalCta() {
  const t = useTranslations("mineral.closing");
  return (
    <section data-theme="dark" className="closing-chapter" id="convergence">
      <ChapterFrame>
        <ChapterLabel label={t("eyebrow")} />
        <h2 className="m-display">
          {t("title")}
          <span>{t("accent")}</span>
        </h2>
        <p>{t("body")}</p>
        <div className="closing-actions">
          <ButtonLink href="/demo">
            {t("cta")}
            <ArrowRight size={15} className="rtl:-scale-x-100" />
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary">
            {t("secondary")}
          </ButtonLink>
        </div>
      </ChapterFrame>
    </section>
  );
}
