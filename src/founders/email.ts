import type { FundedCompany } from "./funding";
import { linkedinCompanySearch, type Profile } from "./linkedin";

const TZ = "Asia/Kolkata";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A company with founders found and no one in the listed roles. */
export interface FounderTarget {
  company: FundedCompany;
  founders: Profile[];
}

export function buildFoundersDigest(targets: FounderTarget[], roles: string[], notes: string[], now = new Date()) {
  const stamp = now.toLocaleString("en-IN", { day: "numeric", month: "short", timeZone: TZ });
  const n = targets.length;
  const subject = `${n} startup${n === 1 ? "" : "s"} to DM: no GTM / Founder's Office / CoS / PMM — ${stamp}`;
  const intro = `Recently funded startups where no one on LinkedIn currently works there as ${roles.slice(0, 5).join(", ")} or similar (${roles.length} titles in config/founders.yaml). Check the company's People tab before you DM.`;
  const note = notes.length ? notes.join(" ") : "";

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 8px">${esc(subject)}</h2>
<p style="color:#555;font-size:13px;margin:0 0 16px">${esc(intro)}</p>
${targets
  .map(
    (t) => `<div style="padding:10px 0;border-bottom:1px solid #eee">
<a href="${esc(linkedinCompanySearch(t.company.name))}" style="font-weight:700;font-size:15px;color:#1a1a1a;text-decoration:none">${esc(t.company.name)}</a>
<span style="font-size:12px"> · <a href="${esc(t.company.url)}" style="color:#666">${esc(t.company.headline)}</a></span><br>
${t.founders
  .map(
    (f) =>
      `<a href="${esc(f.url)}" style="color:#0b57d0;font-weight:600;text-decoration:none">${esc(f.name)}</a>${
        f.headline ? ` <span style="color:#666;font-size:12px">${esc(f.headline)}</span>` : ""
      }`,
  )
  .join("<br>")}</div>`,
  )
  .join("\n")}
${note ? `<p style="margin-top:24px;color:#888;font-size:12px">${esc(note)}</p>` : ""}
</body></html>`;

  const text = [
    subject,
    "",
    intro,
    "",
    ...targets.flatMap((t) => [
      `${t.company.name} — ${linkedinCompanySearch(t.company.name)}`,
      ...t.founders.map((f) => `  • ${f.name}${f.headline ? ` (${f.headline})` : ""}: ${f.url}`),
      "",
    ]),
    ...(note ? [note] : []),
  ].join("\n");

  return { subject, html, text };
}
