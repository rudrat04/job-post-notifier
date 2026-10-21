import type { MatchedJob, SourceFailure } from "./types";

const TZ = "Asia/Kolkata";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: TZ });
}

function groupByCompany(jobs: MatchedJob[]): Map<string, MatchedJob[]> {
  const groups = new Map<string, MatchedJob[]>();
  for (const j of [...jobs].sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title))) {
    groups.set(j.company, [...(groups.get(j.company) ?? []), j]);
  }
  return groups;
}

const MAX_FAILURES_SHOWN = 8;

function failureNote(failures: SourceFailure[]): string {
  const shown = failures.slice(0, MAX_FAILURES_SHOWN).map((f) => `${f.company} (${f.reason})`);
  const more = failures.length - shown.length;
  return `Couldn't check: ${shown.join("; ")}${more > 0 ? ` and ${more} more` : ""}`;
}

export function buildDigest(jobs: MatchedJob[], failures: SourceFailure[], now = new Date()) {
  const when = now.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true, timeZone: TZ });
  const subject = `${jobs.length} new role${jobs.length === 1 ? "" : "s"} — ${when.replace(/,/, "")}`;
  const groups = groupByCompany(jobs);

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 16px">${esc(subject)}</h2>
${[...groups]
  .map(
    ([company, list]) => `<h3 style="margin:20px 0 6px;font-size:15px">${esc(company)}</h3>
<table style="border-collapse:collapse;width:100%">${list
      .map(
        (j) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">
<a href="${esc(j.url)}" style="color:#0b57d0;font-weight:600;text-decoration:none">${esc(j.title)}</a><br>
<span style="color:#555;font-size:13px">${esc(j.location || "Location not listed")}${j.locationMissing ? " ⚠️" : ""}${
          formatDate(j.postedAt) ? ` · posted ${formatDate(j.postedAt)}` : ""
        }</span></td></tr>`,
      )
      .join("")}</table>`,
  )
  .join("\n")}
${
  failures.length
    ? `<p style="margin-top:24px;color:#888;font-size:12px">${esc(failureNote(failures))}</p>`
    : ""
}
</body></html>`;

  const text = [
    subject,
    "",
    ...[...groups].flatMap(([company, list]) => [
      company,
      ...list.map(
        (j) =>
          `  • ${j.title} — ${j.location || "location not listed"}${formatDate(j.postedAt) ? ` (posted ${formatDate(j.postedAt)})` : ""}\n    ${j.url}`,
      ),
      "",
    ]),
    ...(failures.length ? [failureNote(failures)] : []),
  ].join("\n");

  return { subject, html, text };
}

export async function sendEmail(digest: { subject: string; html: string; text: string }): Promise<void> {
  const { RESEND_API_KEY, EMAIL_TO, EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !EMAIL_TO) throw new Error("RESEND_API_KEY and EMAIL_TO must be set to send email");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM || "Job Notifier <onboarding@resend.dev>",
      to: EMAIL_TO.split(",").map((s) => s.trim()),
      ...digest,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed: HTTP ${res.status} ${await res.text()}`);
}
