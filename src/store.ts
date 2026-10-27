import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SeenRow {
  id: string;
  company: string;
  title: string;
  url: string;
  source: string;
}

const CHUNK = 500;

export function createStore(table = "seen_jobs") {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  return {
    async seenIds(ids: string[]): Promise<Set<string>> {
      const seen = new Set<string>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await db.from(table).select("id").in("id", ids.slice(i, i + CHUNK));
        if (error) throw new Error(`Supabase read failed: ${error.message}`);
        for (const row of data) seen.add(row.id);
      }
      return seen;
    },

    async markSeen(jobs: SeenRow[]): Promise<void> {
      for (let i = 0; i < jobs.length; i += CHUNK) {
        const rows = jobs.slice(i, i + CHUNK).map((j) => ({
          id: j.id,
          company: j.company,
          title: j.title,
          url: j.url,
          source: j.source,
        }));
        const { error } = await db.from(table).upsert(rows, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new Error(`Supabase write failed: ${error.message}`);
      }
    },
  };
}

export type Store = NonNullable<ReturnType<typeof createStore>>;
