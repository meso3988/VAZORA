import type { DataProvider } from "@/data/repositories";

export type ContractListRead =
  | { ok: true; contracts: Awaited<ReturnType<DataProvider["contracts"]["list"]>> }
  | { ok: false; contracts: [] };

/**
 * Read a tenant's contract list for a page.
 * Three outcomes only: records, a genuine empty list, or an explicit failure.
 * A failed read is never converted to [] — callers render an unavailable
 * state instead of an empty-state or a zero. Demo sessions keep the
 * in-memory fixtures (which cannot fail), never as a failure fallback.
 */
export async function readContractList(
  db: Readonly<DataProvider>,
  orgId: string,
  isDemo: boolean,
): Promise<ContractListRead> {
  try {
    if (isDemo) {
      // Explicit demo fixtures — never a live-tenant fallback.
      return { ok: true, contracts: await db.contracts.list(orgId) };
    }
    if (db.contracts.listChecked) {
      const read = await db.contracts.listChecked(orgId);
      return read.ok ? { ok: true, contracts: read.contracts } : { ok: false, contracts: [] };
    }
    // Live mode without an error-preserving reader: explicit unavailable,
    // not a silent fall back to a reader that turns failure into [].
    return { ok: false, contracts: [] };
  } catch {
    return { ok: false, contracts: [] };
  }
}

export type ContractRead =
  | { status: "found"; contract: NonNullable<Awaited<ReturnType<DataProvider["contracts"]["getById"]>>> }
  | { status: "not_found" }
  | { status: "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read one contract for a detail page.
 * Three outcomes only: found, a genuine not-found, or an explicit failure.
 * A failed read is never collapsed into "not found". A malformed id is
 * not_found without a database round-trip; a foreign-tenant id resolves
 * to not_found through the tenant-scoped query, without disclosing that
 * the contract exists elsewhere. Demo sessions read fixtures via getById.
 */
export async function readContract(
  db: Readonly<DataProvider>,
  orgId: string,
  id: string,
  isDemo: boolean,
): Promise<ContractRead> {
  try {
    if (isDemo) {
      // Demo fixture ids are not UUIDs — the format check is for live ids only.
      const contract = await db.contracts.getById(orgId, id);
      return contract ? { status: "found", contract } : { status: "not_found" };
    }
    if (!UUID.test(id)) return { status: "not_found" };
    if (db.contracts.getByIdChecked) return await db.contracts.getByIdChecked(orgId, id);
    // Live mode without an error-preserving reader: explicit unavailable,
    // not a silent fall back to a reader that turns failure into null.
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export type ObligationListRead =
  | { ok: true; obligations: Awaited<ReturnType<DataProvider["obligations"]["list"]>> }
  | { ok: false; obligations: [] };

/**
 * Read a tenant's obligation list for a page.
 * Same three outcomes as readContractList: records, a genuine empty
 * list, or an explicit failure — never [] on a failed read. Demo
 * sessions keep the in-memory fixtures via list().
 */
export async function readObligationList(
  db: Readonly<DataProvider>,
  orgId: string,
  isDemo: boolean,
  filter?: { contractId?: string },
): Promise<ObligationListRead> {
  try {
    if (isDemo) {
      return { ok: true, obligations: await db.obligations.list(orgId, filter) };
    }
    if (db.obligations.listChecked) {
      const read = await db.obligations.listChecked(orgId, filter);
      return read.ok ? { ok: true, obligations: read.obligations } : { ok: false, obligations: [] };
    }
    return { ok: false, obligations: [] };
  } catch {
    return { ok: false, obligations: [] };
  }
}

export type ObligationRead =
  | { status: "found"; obligation: NonNullable<Awaited<ReturnType<DataProvider["obligations"]["getById"]>>> }
  | { status: "not_found" }
  | { status: "unavailable" };

/**
 * Read one obligation. Demo fixture ids are not UUIDs — the format
 * check is live-only. A foreign-tenant id resolves to not_found
 * through the tenant-scoped query without existence disclosure.
 */
export async function readObligation(
  db: Readonly<DataProvider>,
  orgId: string,
  id: string,
  isDemo: boolean,
): Promise<ObligationRead> {
  try {
    if (isDemo) {
      const obligation = await db.obligations.getById(orgId, id);
      return obligation ? { status: "found", obligation } : { status: "not_found" };
    }
    if (!UUID.test(id)) return { status: "not_found" };
    if (db.obligations.getByIdChecked) return await db.obligations.getByIdChecked(orgId, id);
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export type EvidenceListRead =
  | { ok: true; evidence: Awaited<ReturnType<DataProvider["evidence"]["list"]>> }
  | { ok: false; evidence: [] };

/**
 * Read a tenant's evidence list for a page.
 * Three outcomes: records, a genuine empty list, or explicit failure.
 * The supabase listChecked implementation also fails on a failed
 * dependent verification-run/check read, so callers never render
 * "no verification" off a dropped read.
 */
export async function readEvidenceList(
  db: Readonly<DataProvider>,
  orgId: string,
  isDemo: boolean,
  filter?: { contractId?: string; obligationId?: string },
): Promise<EvidenceListRead> {
  try {
    if (isDemo) {
      return { ok: true, evidence: await db.evidence.list(orgId, filter) };
    }
    if (db.evidence.listChecked) {
      const read = await db.evidence.listChecked(orgId, filter);
      return read.ok ? { ok: true, evidence: read.evidence } : { ok: false, evidence: [] };
    }
    return { ok: false, evidence: [] };
  } catch {
    return { ok: false, evidence: [] };
  }
}
