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
  switch (kind) {
    case "mock":
      cached = mockDataProvider;
      break;
    case "supabase":
      cached = createSupabaseDataProvider();
      break;
    default:
      throw new Error(`Unsupported VAZORA_DATA_PROVIDER "${kind}". Expected "mock" or "supabase".`);
  }
  return cached;
}

export type { DataProvider } from "./repositories";
