"use server";

export type DemoRequestState = {
  status: "idle" | "success" | "error";
  errors?: Partial<Record<"name" | "email" | "organization", "required" | "email">>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phase 1: validates and acknowledges. Phase 2 persists to `demo_requests`
 * and notifies the team; no CRM or email provider is called here.
 */
export async function submitDemoRequest(
  _prev: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const organization = String(formData.get("organization") ?? "").trim();

  const errors: DemoRequestState["errors"] = {};
  if (!name) errors.name = "required";
  if (!email) errors.email = "required";
  else if (!EMAIL.test(email)) errors.email = "email";
  if (!organization) errors.organization = "required";

  if (Object.keys(errors).length) return { status: "error", errors };

  return { status: "success" };
}
