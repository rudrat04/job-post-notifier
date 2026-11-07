import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Month key in UTC, e.g. "2026-11"; Google totals usage per calendar month. */
export const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);

/**
 * Counts Places API requests per month in Supabase (table maps_usage) and remembers which
 * businesses were already emailed (table seen_places, place IDs only, which Google allows
 * storing indefinitely). A request is counted BEFORE it is sent, so a crash can only
 * over-count, never under-count.
 */
export function createProspectStore() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  return {
    async used(month = monthKey()): Promise<number> {
      const { data, error } = await db.from("maps_usage").select("requests").eq("month", month).maybeSingle();
      if (error) throw new Error(`Supabase read failed: ${error.message}`);
      return data?.requests ?? 0;
    },

    async record(requests: number, month = monthKey()): Promise<void> {
      const { error } = await db.from("maps_usage").upsert({ month, requests, updated_at: new Date().toISOString() });
      if (error) throw new Error(`Supabase write failed: ${error.message}`);
    },

    async seenIds(ids: string[]): Promise<Set<string>> {
      const seen = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await db.from("seen_places").select("id").in("id", ids.slice(i, i + 500));
        if (error) throw new Error(`Supabase read failed: ${error.message}`);
        for (const row of data) seen.add(row.id);
      }
      return seen;
    },

    async markSeen(ids: string[]): Promise<void> {
      if (!ids.length) return;
      const { error } = await db.from("seen_places").upsert(ids.map((id) => ({ id })), { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Supabase write failed: ${error.message}`);
    },
  };
}

/**
 * Hands out request slots until either the monthly or the per-run limit is reached.
 * `reserve` returns false once the budget is spent; it persists the new total first.
 */
export function createBudget(opts: {
  usedThisMonth: number;
  monthly: number;
  perRun: number;
  persist: (total: number) => Promise<void>;
}) {
  let total = opts.usedThisMonth;
  let run = 0;
  return {
    get used() {
      return total;
    },
    get runCount() {
      return run;
    },
    async reserve(): Promise<boolean> {
      if (total + 1 > opts.monthly || run + 1 > opts.perRun) return false;
      await opts.persist(total + 1);
      total += 1;
      run += 1;
      return true;
    },
  };
}
