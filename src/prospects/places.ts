import { request } from "../http";

export interface Place {
  id: string;
  name: string;
  address: string;
  type?: string;
  status?: string;
  mapsUrl?: string;
  website?: string;
  rating?: number;
  reviewCount: number;
  /** Text of up to 5 recent reviews, only when reviews were requested. */
  reviews: string[];
}

interface ApiPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  primaryType?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  reviews?: { text?: { text?: string }; originalText?: { text?: string } }[];
}

/**
 * Field mask. id/displayName/formattedAddress/primaryType/businessStatus/googleMapsUri
 * are Pro fields; websiteUri/rating/userRatingCount make it the Enterprise SKU; reviews
 * make it Enterprise + Atmosphere. Billing uses the highest SKU among the fields.
 */
export function fieldMask(withReviews: boolean): string {
  const fields = [
    "id",
    "displayName",
    "formattedAddress",
    "primaryType",
    "businessStatus",
    "googleMapsUri",
    "websiteUri",
    "rating",
    "userRatingCount",
    ...(withReviews ? ["reviews"] : []),
  ];
  return fields.map((f) => `places.${f}`).join(",");
}

export function toPlace(p: ApiPlace): Place {
  return {
    id: p.id,
    name: p.displayName?.text ?? "Unnamed",
    address: p.formattedAddress ?? "",
    type: p.primaryType,
    status: p.businessStatus,
    mapsUrl: p.googleMapsUri,
    website: p.websiteUri,
    rating: p.rating,
    reviewCount: p.userRatingCount ?? 0,
    reviews: (p.reviews ?? []).map((r) => r.originalText?.text ?? r.text?.text ?? "").filter(Boolean),
  };
}

/**
 * One Text Search (New) request: a single page of up to 20 places. Never retried and
 * never paged, so each call is exactly one billable request. The caller must have
 * reserved it in the usage budget first.
 */
export async function textSearch(apiKey: string, query: string, withReviews: boolean): Promise<Place[]> {
  const res = await request(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": fieldMask(withReviews),
      },
      body: JSON.stringify({ textQuery: query, pageSize: 20, regionCode: "IN", languageCode: "en" }),
    },
    0,
  );
  const data = (await res.json()) as { places?: ApiPlace[] };
  return (data.places ?? []).map(toPlace);
}
