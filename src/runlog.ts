import { createClient } from "@supabase/supabase-js";

export type Script = "jobs" | "prospects" | "founders";

const WRITE_TIMEOUT_MS = 10_000;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The run mode from the command-line flags. */
export function modeFrom(args: Set<string>): string {
  if (args.has("--dry-run")) return "dry-run";
  if (args.has("--bootstrap")) return "bootstrap";
  if (args.has("--test-email")) return "test-email";
  return "normal";
}

/**
 * Records one row per run in the Supabase `run_logs` table (migration 006). Fill in
 * `counts` and `failures` while the run goes, then call `finish` once at the end, with
 * the error if the run crashed. Logging is best effort: it never throws, gives up after
 * 10s, and does nothing when Supabase isn't configured, so it can't break a run or an email.
 */
export function startRun(script: Script, mode: string) {
  const startedAt = new Date();
  const run = {
    counts: {} as Record<string, number>,
    failures: [] as string[],

    async finish(err?: unknown): Promise<void> {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) return;
      const status = err !== undefined ? "failed" : run.failures.length ? "partial" : "ok";
      const row = {
        script,
        mode,
        status,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
        counts: run.counts,
        failures: run.failures,
        error: err !== undefined ? errorMessage(err) : null,
      };
      try {
        const db = createClient(url, key, { auth: { persistSession: false } });
        const write = db.from("run_logs").insert(row).abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS));
        const { error } = await write;
        if (error) console.warn(`Run log not saved: ${error.message} (run supabase/migrations/006_run_logs.sql?)`);
      } catch (e) {
        console.warn(`Run log not saved: ${errorMessage(e)}`);
      }
    },
  };
  return run;
}
