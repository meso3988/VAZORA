import "server-only";

import { auth } from "@/data/auth/provider";
import { getDataProvider } from "@/data";
import type { DataProvider } from "@/data/repositories";
import type { Session } from "@/data/auth/session";

export type TenantContext = { session: Session; orgId: string; db: DataProvider };

/**
 * Resolves the caller's tenant. Pages under /app rely on the layout having
 * already redirected unauthenticated visitors, so a missing session here is a
 * programming error rather than a user-facing state.
 */
export async function requireTenant(): Promise<TenantContext> {
  const session = await auth.getSession();
  if (!session) throw new Error("No session in an authenticated route.");
  return { session, orgId: session.organizationId, db: getDataProvider() };
}
