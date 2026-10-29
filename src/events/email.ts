import type { EventItem } from "./types";

const TZ = "Asia/Kolkata";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function formatStart(start: string): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }
  return d.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

function group(events: EventItem[]): Map<string, EventItem[]> {
  const groups = new Map<string, EventItem[]>();
  for (const e of [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    groups.set(e.where, [...(groups.get(e.where) ?? []), e]);
  }
  // Online first, then cities alphabetically.
  return new Map([...groups].sort(([a], [b]) => (a === "Online" ? -1 : b === "Online" ? 1 : a.localeCompare(b))));
}

const line = (e: EventItem) =>
  [formatStart(e.start), e.host, e.needsApproval ? "host approves registrations" : ""].filter(Boolean).join(" · ");

export function buildEventsDigest(events: EventItem[], failures: string[] = [], now = new Date()) {
  const when = now.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: TZ });
  const subject = `${events.length} free event${events.length === 1 ? "" : "s"} open for registration — ${when}`;
  const groups = group(events);

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 16px">${esc(subject)}</h2>
${[...groups]
  .map(
    ([where, list]) => `<h3 style="margin:20px 0 6px;font-size:15px">${esc(where)}</h3>
<table style="border-collapse:collapse;width:100%">${list
      .map(
        (e) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">
<a href="${esc(e.url)}" style="color:#0b57d0;font-weight:600;text-decoration:none">${esc(e.title)}</a><br>
<span style="color:#555;font-size:13px">${esc(line(e))}</span></td></tr>`,
      )
      .join("")}</table>`,
  )
  .join("\n")}
${failures.length ? `<p style="margin-top:24px;color:#888;font-size:12px">${esc(`Couldn't check: ${failures.join("; ")}`)}</p>` : ""}
</body></html>`;

  const text = [
    subject,
    "",
    ...[...groups].flatMap(([where, list]) => [where, ...list.map((e) => `  • ${e.title} — ${line(e)}\n    ${e.url}`), ""]),
    ...(failures.length ? [`Couldn't check: ${failures.join("; ")}`] : []),
  ].join("\n");

  return { subject, html, text };
}
