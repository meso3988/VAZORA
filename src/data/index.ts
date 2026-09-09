import "server-only";

import { mockDataProvider } from "./mock/provider";
import type { DataProvider } from "./repositories";
import { createSupabaseDataProvider } from "./supabase/provider";

let cached: DataProvider | null = null;

/**
 * Single entry point for data access. Server components and server actions
 * call `getDataProvider()`; UI never imports mock data directly.
 */
export function getDataProvider(): DataProvider {
  if (cached) return cached;
  const kind = process.env.VAZORA_DATA_PROVIDER ?? "mock";
  cached = kind === "supabase" ? createSupabaseDataProvider() : mockDataProvider;
  return cached;
}

export type { DataProvider } from "./repositories";
