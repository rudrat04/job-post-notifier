import type { Lead, LeadSource } from "./types";

const TZ = "Asia/Kolkata";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const HEADINGS: Record<LeadSource, string> = {
  reddit: "Reddit: people asking for help",
  hackernews: "Hacker News",
  freelancer: "Freelancer.com projects",
  funding: "Newly funded startups",
};
const ORDER: LeadSource[] = ["reddit", "hackernews", "freelancer", "funding"];

const snippet = (s: string) => (s.length > 220 ? `${s.slice(0, 220).trimEnd()}…` : s);

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true, timeZone: TZ });
}

const meta = (l: Lead) =>
  [l.origin, l.author && `by ${l.author}`, l.budget && `budget ${l.budget}`, when(l.postedAt)].filter(Boolean).join(" · ");

export function buildLeadsDigest(leads: Lead[], failures: string[], now = new Date()) {
  const stamp = now.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true, timeZone: TZ });
  const subject = `${leads.length} new freelance lead${leads.length === 1 ? "" : "s"} — ${stamp.replace(/,/, "")}`;
  const groups = ORDER.map((s) => [s, leads.filter((l) => l.source === s)] as const).filter(([, l]) => l.length);
  const note = failures.length ? `Couldn't check: ${failures.slice(0, 8).join("; ")}${failures.length > 8 ? ` and ${failures.length - 8} more` : ""}` : "";

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 16px">${esc(subject)}</h2>
${groups
  .map(
    ([source, list]) => `<h3 style="margin:20px 0 6px;font-size:15px">${esc(HEADINGS[source])}</h3>
${list
  .map(
    (l) => `<div style="padding:8px 0;border-bottom:1px solid #eee">
<a href="${esc(l.url)}" style="color:#0b57d0;font-weight:600;text-decoration:none">${esc(l.title)}</a><br>
${l.text ? `<span style="font-size:13px">${esc(snippet(l.text))}</span><br>` : ""}
<span style="color:#666;font-size:12px">${esc(meta(l))}</span></div>`,
  )
  .join("")}`,
  )
  .join("\n")}
${note ? `<p style="margin-top:24px;color:#888;font-size:12px">${esc(note)}</p>` : ""}
</body></html>`;

  const text = [
    subject,
    "",
    ...groups.flatMap(([source, list]) => [
      HEADINGS[source],
      ...list.map((l) => `  • ${l.title}\n    ${meta(l)}\n    ${l.url}`),
      "",
    ]),
    ...(note ? [note] : []),
  ].join("\n");

  return { subject, html, text };
}
