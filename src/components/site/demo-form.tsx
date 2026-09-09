"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";

import { submitDemoRequest, type DemoRequestState } from "@/app/[locale]/(site)/demo/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SECTORS = [
  "operations_maintenance",
  "construction",
  "facilities_management",
  "technology_services",
  "supply",
  "government",
] as const;

const field =
  "h-11 w-full rounded-sm border border-line bg-bg px-3 text-sm text-fg placeholder:text-faint focus:border-fg/50 focus:outline-none";
const label = "text-xs font-medium text-muted";

export function DemoForm() {
  const t = useTranslations("demo");
  const sectors = useTranslations("sector");
  const locale = useLocale();
  const contractsOptions = t.raw("form.contractsOptions") as string[];
  const [state, action, pending] = useActionState<DemoRequestState, FormData>(submitDemoRequest, {
    status: "idle",
  });

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-start gap-5 surface-float p-8">
        <span className="flex size-10 items-center justify-center rounded-sm bg-verified/15 text-verified">
          <Check size={18} />
        </span>
        <div>
          <h2 className="text-xl font-medium">{t("success.title")}</h2>
          <p className="mt-2 text-sm text-muted">{t("success.body")}</p>
        </div>
        <ButtonLink href="/" variant="secondary">{t("success.back")}</ButtonLink>
      </div>
    );
  }

  const err = (k: "name" | "email" | "organization") =>
    state.errors?.[k] ? t(`errors.${state.errors[k]}`) : null;
  const v = state.values ?? {};

  return (
    <form action={action} className="grid grid-cols-1 gap-5 surface-float p-6 sm:grid-cols-2 sm:p-8" noValidate>
      <Field label={t("form.name")} error={err("name")}>
        <input name="name" defaultValue={v.name} className={cn(field, err("name") && "border-missing")} autoComplete="name" required />
      </Field>
      <Field label={t("form.email")} error={err("email")}>
        <input name="email" type="email" defaultValue={v.email} className={cn(field, err("email") && "border-missing")} autoComplete="email" dir="ltr" required />
      </Field>
      <Field label={t("form.organization")} error={err("organization")}>
        <input name="organization" defaultValue={v.organization} className={cn(field, err("organization") && "border-missing")} autoComplete="organization" required />
      </Field>
      <Field label={t("form.role")}>
        <input name="role" defaultValue={v.role} className={field} autoComplete="organization-title" />
      </Field>
      <Field label={t("form.sector")}>
        <select key={v.sector ?? ""} name="sector" className={field} defaultValue={v.sector ?? ""}>
          <option value="" disabled>{t("form.sectorPlaceholder")}</option>
          {SECTORS.map((s) => (
            <option key={s} value={s}>{sectors(s)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("form.contracts")}>
        <select key={v.contracts ?? ""} name="contracts" className={field} defaultValue={v.contracts || contractsOptions[0]}>
          {contractsOptions.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </Field>
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className={label}>{t("form.language")}</legend>
        <div className="flex gap-2">
          {(["en", "ar"] as const).map((l) => (
            <label key={l} className="flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-line px-3 text-sm has-checked:border-fg/60 has-checked:bg-fg/5">
              <input type="radio" name="language" value={l} defaultChecked={l === (v.language || locale)} className="accent-accent" />
              <span lang={l}>{l === "en" ? "English" : "العربية"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t("form.message")} className="sm:col-span-2">
        <textarea name="message" rows={4} defaultValue={v.message} className={cn(field, "h-auto py-3")} />
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-faint">{t("form.privacy")}</p>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t("form.submitting") : t("form.submit")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label: text,
  error,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className={label}>{text}</span>
      {children}
      {error && <span className="text-xs text-missing">{error}</span>}
    </label>
  );
}
