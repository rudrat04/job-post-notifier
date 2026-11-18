import { request } from "../http";

export interface SearchResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

/** Both search APIs bill per request, so a failed one is never retried. */
async function getPaidJson<T>(url: string, init?: RequestInit): Promise<T> {
  return (await request(url, init, 0)).json() as Promise<T>;
}

/** Serper (Google results). One credit per search. */
async function viaSerper(key: string, q: string, days: number | undefined, num: number): Promise<SearchResult[]> {
  const data = await getPaidJson<{ organic?: SearchResult[] }>("https://google.serper.dev/search", {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    // Free Serper accounts reject more than 10 results per search.
    body: JSON.stringify({ q, num: Math.min(num, 10), ...(days ? { tbs: `qdr:d${days}` } : {}), gl: "in", hl: "en" }),
  });
  return data.organic ?? [];
}

/** SerpApi, used when Serper fails or has no key. */
async function viaSerpApi(key: string, q: string, days: number | undefined, num: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ engine: "google", q, num: String(num), gl: "in", hl: "en", api_key: key });
  if (days) params.set("tbs", `qdr:d${days}`);
  const data = await getPaidJson<{ organic_results?: SearchResult[]; error?: string }>(`https://serpapi.com/search.json?${params}`);
  if (data.error && /hasn't returned any results/i.test(data.error)) return [];
  if (data.error) throw new Error(`SerpApi: ${data.error}`);
  return data.organic_results ?? [];
}

export function hasSearchKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SERPER_API_KEY || env.SERPAPI_KEY);
}

/** Google results through Serper, falling back to SerpApi. `days` limits results to the last N days. */
export async function googleSearch(
  query: string,
  days: number | undefined,
  num: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SearchResult[]> {
  try {
    if (!env.SERPER_API_KEY) throw new Error("no Serper key");
    return await viaSerper(env.SERPER_API_KEY, query, days, num);
  } catch (err) {
    if (!env.SERPAPI_KEY) throw err;
    try {
      return await viaSerpApi(env.SERPAPI_KEY, query, days, num);
    } catch (fallbackErr) {
      throw new Error(`${(err as Error).message}; then ${(fallbackErr as Error).message}`);
    }
  }
}
