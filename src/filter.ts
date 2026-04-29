// Classify an AlertDC alert based on its title.
//
//   "Crime Alert 1st District (PSA 101-108)" -> drop
//   Everything else                          -> post, with a category emoji

import type { Alert } from "./scrape";

export const CATEGORIES: Record<string, string> = {
  traffic: "🚧",
  event: "📅",
  weather: "⛈️",
  police: "🚔",
  other: "🔔",
};

export type Classification =
  | { kind: "post"; category: string }
  | { kind: "drop"; reason: string };

const CATEGORY_RULES: [RegExp, string][] = [
  [/Tornado|Severe Weather|Snow Emergency|Cold Alert|Heat (?:Alert|Emergency)|Flood|Winter Storm|NWS\b/i, "weather"],
  [/special event|parking restriction|street closure/i, "event"],
  [/DDOT|Tunnel|Lane|Road Closure|Traffic/i, "traffic"],
  [/Secret Service|Police Activity/i, "police"],
];

export function classify(alert: Alert): Classification {
  const t = alert.title.trim();
  if (!t) return { kind: "drop", reason: "empty title" };
  if (/^Crime Alert\b/i.test(t)) return { kind: "drop", reason: "crime alert" };

  for (const [re, category] of CATEGORY_RULES) {
    if (re.test(t)) return { kind: "post", category };
  }
  return { kind: "post", category: "other" };
}
