import "server-only";

import { auth } from "@/data/auth/provider";
import { getDataProvider } from "@/data";
import { mockDataProvider } from "@/data/mock/provider";
import type { DataProvider } from "@/data/repositories";
import type { Session } from "@/data/auth/session";

export type TenantContext = { session: Session; orgId: string; db: Readonly<DataProvider> };

/**
 * Resolves the caller's tenant. Pages under /app rely on the layout having
 * already redirected unauthenticated visitors, so a missing session here is a
 * programming error rather than a user-facing state.
 *
 * Demo sessions keep the in-memory provider so illustrative fixtures never
 * touch tenant rows; live sessions use the configured provider with the
 * organization derived from auth (never from client input).
 *
 * In live mode a user without an organization still reaches the layout (the
 * layout redirects to onboarding), so orgId may be "" — live pages calling
 * this should first go through `requireTenantOrg`.
 */
export async function requireTenant(): Promise<TenantContext> {
  const session = await auth.getSession();
  if (!session) throw new Error("No session in an authenticated route.");
  if (session.mode === "demo") {
    return { session, orgId: session.organizationId, db: mockDataProvider };
  }
  const orgId = session.organizationId;
  return { session, orgId, db: getDataProvider() };
}
