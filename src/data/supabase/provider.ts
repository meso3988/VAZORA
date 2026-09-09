import type { DataProvider } from "@/data/repositories";

/**
 * Supabase-backed provider (Phase 2).
 *
 * Wiring plan:
 *  - `@supabase/ssr` client created per request with the user's cookies, so RLS
 *    policies (see supabase/migrations) enforce organization isolation.
 *  - Each repository maps a table (contracts, obligations, evidence, …) to the
 *    domain types in src/domain/types.ts. Localized text columns are stored as
 *    jsonb `{ "en": …, "ar": … }`.
 *  - pgvector is enabled in the initial migration for clause embeddings.
 *
 * The provider is intentionally unimplemented in Phase 1 so nothing pretends to
 * be persisted data. `getDataProvider()` never returns it unless
 * VAZORA_DATA_PROVIDER=supabase is set.
 */
export function createSupabaseDataProvider(): DataProvider {
  throw new Error(
    "Supabase data provider is not enabled in Phase 1. Set VAZORA_DATA_PROVIDER=mock.",
  );
}
