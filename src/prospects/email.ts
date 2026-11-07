import type { Prospect } from "./score";

const TZ = "Asia/Kolkata";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const humanType = (t?: string) => (t ? t.replace(/_/g, " ") : "");

const meta = (p: Prospect & { city: string }) =>
  [humanType(p.type), p.city, p.rating ? `★ ${p.rating.toFixed(1)} (${p.reviewCount})` : `${p.reviewCount} reviews`]
    .filter(Boolean)
    .join(" · ");

export function buildProspectsDigest(
  prospects: (Prospect & { city: string })[],
  info: { requests: number; usedThisMonth: number; monthly: number; failures: string[] },
  now = new Date(),
) {
  const stamp = now.toLocaleString("en-IN", { day: "numeric", month: "short", timeZone: TZ });
  const subject = `${prospects.length} prospect${prospects.length === 1 ? "" : "s"} from Google Maps — ${stamp}`;
  const usage = `Used ${info.requests} Places requests this run, ${info.usedThisMonth} of ${info.monthly} this month (Google's free tier is 1,000).`;
  const failures = info.failures.length ? `Couldn't check: ${info.failures.slice(0, 6).join("; ")}` : "";

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 4px">${esc(subject)}</h2>
<p style="margin:0 0 16px;color:#666;font-size:13px">Businesses that look like they need GTM or automation help, strongest first. Reach out by hand.</p>
${prospects
  .map(
    (p) => `<div style="padding:10px 0;border-bottom:1px solid #eee">
<a href="${esc(p.mapsUrl ?? "#")}" style="color:#0b57d0;font-weight:600;text-decoration:none">${esc(p.name)}</a>
<span style="color:#888;font-size:12px"> · score ${p.score}</span><br>
<span style="color:#555;font-size:13px">${esc(meta(p))}</span><br>
${p.website ? `<a href="${esc(p.website)}" style="font-size:13px;color:#0b57d0">${esc(p.website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a><br>` : ""}
<ul style="margin:4px 0;padding-left:18px;font-size:13px">${p.signals.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
${p.pitch ? `<span style="font-size:13px"><b>Pitch:</b> ${esc(p.pitch)}</span>` : ""}
</div>`,
  )
  .join("\n")}
<p style="margin-top:24px;color:#888;font-size:12px">${esc(usage)}${failures ? `<br>${esc(failures)}` : ""}<br>Business data © Google Maps.</p>
</body></html>`;

  const text = [
    subject,
    "",
    ...prospects.flatMap((p) => [
      `• ${p.name} (score ${p.score})`,
      `  ${meta(p)}`,
      ...(p.website ? [`  ${p.website}`] : []),
      ...p.signals.map((s) => `  - ${s}`),
      ...(p.pitch ? [`  Pitch: ${p.pitch}`] : []),
      `  ${p.mapsUrl ?? ""}`,
      "",
    ]),
    usage,
    ...(failures ? [failures] : []),
    "Business data © Google Maps.",
  ].join("\n");

  return { subject, html, text };
}
