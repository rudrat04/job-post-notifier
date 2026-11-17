const USER_AGENT = "job-post-notifier/0.1 (+personal job alerts)";

export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    // Only the path: query strings can carry API keys (SerpApi's api_key), and this
    // message is printed in the logs and the digest's "Couldn't check" line.
    super(`HTTP ${status} from ${url.split("?")[0]}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Never wait longer than this for a Retry-After, so a run can't stall for an hour. */
const MAX_RETRY_WAIT_MS = 30_000;

/** GET/POST with a timeout, retrying 429 and 5xx responses with backoff. */
export async function request(
  url: string,
  init: RequestInit = {},
  retries = 3,
  timeoutMs = 20_000,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "user-agent": USER_AGENT, accept: "application/json", ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000;
        await sleep(Math.min(retryAfter || 1000 * 2 ** attempt, MAX_RETRY_WAIT_MS));
        continue;
      }
      throw new HttpError(res.status, url);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt >= retries) {
        if (err instanceof Error && err.name === "TimeoutError") {
          throw new Error(`timed out after ${timeoutMs / 1000}s (${url.split("?")[0]})`);
        }
        throw err;
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  return (await request(url, init)).json() as Promise<T>;
}

export async function getText(url: string): Promise<string> {
  return (await request(url, { headers: { accept: "text/html" } })).text();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
