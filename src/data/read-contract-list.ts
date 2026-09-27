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
