"use server";

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

/**
 * Phase 1: validates and acknowledges. Phase 2 persists to `demo_requests`
 * and notifies the team; no CRM or email provider is called here.
 */
export async function submitDemoRequest(
  _prev: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const values: DemoRequestState["values"] = {};
  for (const f of FIELDS) values[f] = String(formData.get(f) ?? "").trim();
  const { name = "", email = "", organization = "" } = values;

  const errors: DemoRequestState["errors"] = {};
  if (!name) errors.name = "required";
  if (!email) errors.email = "required";
  else if (!EMAIL.test(email)) errors.email = "email";
  if (!organization) errors.organization = "required";

  if (Object.keys(errors).length) return { status: "error", errors, values };

  return { status: "success" };
}
