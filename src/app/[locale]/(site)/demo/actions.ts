"use server";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/supabase/env";

export type DemoRequestField =
  | "name"
  | "email"
  | "organization"
  | "role"
  | "sector"
  | "contracts"
  | "language"
  | "message";

export type DemoRequestState = {
  status: "idle" | "success" | "error";
  errors?: Partial<Record<"name" | "email" | "organization", "required" | "email">>;
  values?: Partial<Record<DemoRequestField, string>>;
};

const FIELDS: DemoRequestField[] = [
  "name",
  "email",
  "organization",
  "role",
  "sector",
  "contracts",
  "language",
  "message",
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITS: Partial<Record<DemoRequestField, number>> = {
  name: 120,
  email: 254,
  organization: 200,
  role: 200,
  message: 4000,
};

/**
 * Persists public demo requests to `demo_requests` using the anon key —
 * public insert is allowed by RLS, reads are denied, so leads never leak.
 * When Supabase is not configured the form still acknowledges (old behavior).
 */
export async function submitDemoRequest(
  _prev: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const values: DemoRequestState["values"] = {};
  for (const f of FIELDS) {
    const raw = String(formData.get(f) ?? "").trim();
    values[f] = raw.slice(0, LIMITS[f] ?? 500);
  }
  const { name = "", email = "", organization = "" } = values;

  const errors: DemoRequestState["errors"] = {};
  if (!name) errors.name = "required";
  if (!email) errors.email = "required";
  else if (!EMAIL.test(email)) errors.email = "email";
  if (!organization) errors.organization = "required";

  if (Object.keys(errors).length) return { status: "error", errors, values };

  const env = getSupabaseEnv();
  if (env) {
    // New anon client — the public form is called before any session exists.
    const supabase = createClient(env.url, env.anonKey, {
      auth: { persistSession: false },
    });
    const { error } = await supabase.from("demo_requests").insert({
      name: values.name,
      email: values.email?.toLowerCase(),
      company: values.organization || null,
      job_title: values.role || null,
      message: values.message || null,
      source: "demo-form",
    });
    if (error) {
      console.error("demo_request insert failed:", error.code);
      return { status: "error", errors: { name: "required" }, values };
    }
  }

  return { status: "success" };
}
