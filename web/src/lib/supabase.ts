import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Reads use the service key because every chalk_* table has RLS enabled with no
// policies. Importing "server-only" makes it a build error for any client
// component to pull this in, so the key cannot reach the browser.

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const PAGE = 1000;

/** PostgREST caps a response at 1000 rows, so every read pages. */
export async function selectAll<T>(
  table: string,
  columns: string,
  tweak: (q: any) => any = (q) => q,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await tweak(
      db().from(table).select(columns).order("id", { ascending: true }).range(from, from + PAGE - 1),
    );
    if (error) throw new Error(`Read from ${table} failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}
