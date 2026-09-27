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
    if (!isDemo && db.contracts.listChecked) {
      const read = await db.contracts.listChecked(orgId);
      return read.ok ? { ok: true, contracts: read.contracts } : { ok: false, contracts: [] };
    }
    return { ok: true, contracts: await db.contracts.list(orgId) };
  } catch {
    return { ok: false, contracts: [] };
  }
}
