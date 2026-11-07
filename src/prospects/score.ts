import { request } from "../http";
import type { Place } from "./places";

/** What a business's home page shows about its tools. */
export interface SiteFacts {
  reachable: boolean;
  store?: "shopify" | "woocommerce";
  emailSms: boolean;
  whatsapp: boolean;
  crm: boolean;
  chat: boolean;
  booking: boolean;
  adPixel: boolean;
  /** Google Tag Manager can load a CRM or chat widget the page source doesn't show. */
  tagManager: boolean;
}

const has = (html: string, re: RegExp) => re.test(html);

export function readSite(html: string): SiteFacts {
  const h = html.toLowerCase();
  return {
    reachable: true,
    store: has(h, /cdn\.shopify\.com|myshopify\.com/) ? "shopify" : has(h, /woocommerce/) ? "woocommerce" : undefined,
    emailSms: has(h, /klaviyo|mailchimp|omnisend|moengage|webengage|clevertap|netcore|privy|attentive|mailmodo|sendinblue|brevo/),
    whatsapp: has(h, /wa\.me\/|api\.whatsapp\.com|wati\.io|interakt|gallabox|aisensy|gupshup|whatsapp-widget/),
    crm: has(h, /hs-scripts\.com|hs-analytics|hubspot|zoho(?:salesiq|crm|public)|salesiq\.zoho|salesforce|pardot|freshsales|freshworks|leadsquared|pipedrive|activecampaign|bitrix24/),
    chat: has(h, /intercom|tawk\.to|crisp\.chat|drift\.com|freshchat|tidio|zendesk|livechat/),
    booking: has(h, /calendly|cal\.com|zcal|youcanbook|setmore|practo|book (?:an? )?appointment/),
    adPixel: has(h, /fbq\(|connect\.facebook\.net|googleadservices|gtag\(['"]config['"],\s*['"]aw-/),
    tagManager: has(h, /googletagmanager\.com\/gtm\.js|gtm-[a-z0-9]{4,}/),
  };
}

const UNREACHABLE: SiteFacts = {
  reachable: false,
  emailSms: false,
  whatsapp: false,
  crm: false,
  chat: false,
  booking: false,
  adPixel: false,
  tagManager: false,
};

/** Fetches the home page once (no retries) and reads which tools it loads. */
export async function checkSite(url: string): Promise<SiteFacts> {
  try {
    const res = await request(url, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; prospect-check/0.1)" } }, 0);
    return readSite((await res.text()).slice(0, 500_000));
  } catch {
    return UNREACHABLE;
  }
}

const COMPLAINT =
  /(?:no|never|didn'?t|did not|don'?t|do not|nobody)\s+(?:\w+\s+){0,2}(?:respon\w*|reply|replied|call(?:ed)?\s+back|get back|follow(?:ed)?[- ]up|pick(?:ed)?\s+up)|not\s+(?:responding|reachable|picking)|unreachable|no follow[- ]?up|slow (?:response|reply)|waited\s+\w+\s+(?:days|weeks)/i;

export interface Prospect extends Place {
  score: number;
  signals: string[];
  pitch: string;
}

/**
 * Points for signs that a business needs GTM or automation help, from its website and
 * reviews. Signals are listed strongest first; the first one sets the pitch.
 */
export function scoreProspect(place: Place, site: SiteFacts | null): Prospect {
  const found: { points: number; signal: string; pitch: string }[] = [];
  const add = (points: number, signal: string, pitch: string) => found.push({ points, signal, pitch });

  const complaints = place.reviews.filter((r) => COMPLAINT.test(r)).length;
  if (complaints) {
    add(
      Math.min(4, complaints * 2),
      `${complaints} recent review${complaints > 1 ? "s" : ""} complain about slow or no response`,
      "Lead follow-up: instant WhatsApp/email replies and a CRM pipeline so no enquiry is missed",
    );
  }

  if (!place.website) {
    if (place.reviewCount >= 50) {
      add(2, `No website despite ${place.reviewCount} reviews`, "Digital basics: a simple site with an enquiry form wired to WhatsApp and a CRM");
    }
  } else if (site && !site.reachable) {
    add(1, "Website didn't load", "Fix the broken website and capture enquiries properly");
  } else if (site) {
    if (site.store && !site.emailSms) {
      add(3, `${site.store === "shopify" ? "Shopify" : "WooCommerce"} store with no email/SMS marketing tool`, "D2C retention: abandoned-cart, post-purchase and win-back flows");
    }
    if (site.store && !site.whatsapp) add(1, "Store has no WhatsApp ordering or support", "WhatsApp commerce: order updates and support automation");
    if (site.adPixel && !site.crm) add(1, "Runs ads but no CRM on the site", "Ads are paid for, but leads aren't tracked: CRM and lead routing");
    if (!site.store && !site.crm && !site.chat && !site.booking) {
      const pitch = "Inbound lead capture: form → CRM → instant reply and follow-up sequence";
      if (site.tagManager) add(1, "No CRM, chat or booking visible (tag manager may hide some tools)", pitch);
      else add(2, "Enquiries land in a plain contact form: no CRM, chat or booking", pitch);
    }
  }

  if (place.reviewCount >= 100) add(1, `${place.reviewCount} Google reviews (established, likely has budget)`, "");

  found.sort((a, b) => b.points - a.points);
  return {
    ...place,
    score: found.reduce((sum, f) => sum + f.points, 0),
    signals: found.map((f) => f.signal),
    pitch: found.find((f) => f.pitch)?.pitch ?? "",
  };
}
