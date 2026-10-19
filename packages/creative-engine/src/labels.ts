import type { LengthBucket, PatternDimension } from "./types";

const FORMAT: Record<string, string> = { static: "Static", video: "Video", carousel: "Carousel", ugc: "UGC" };
const LENGTH: Record<LengthBucket, string> = { short: "Short-form (<15s)", mid: "Mid-form (15-30s)", long: "Long-form (30s+)" };

export function humanize(v: string): string {
  const s = v.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Client-facing label for a pattern value, e.g. "Pain point angle", "UGC", "Short-form (<15s)". */
export function patternLabel(dimension: PatternDimension, value: string): string {
  switch (dimension) {
    case "format": return FORMAT[value] ?? humanize(value);
    case "length": return LENGTH[value as LengthBucket] ?? humanize(value);
    case "angle": return `${humanize(value)} angle`;
    case "visualStyle": return `${humanize(value)} visuals`;
    case "tone": return `${humanize(value)} tone`;
  }
}

export function lengthBucket(sec: number | null | undefined): LengthBucket | null {
  if (sec == null) return null;
  return sec < 15 ? "short" : sec <= 30 ? "mid" : "long";
}

/** Default angle taxonomy. Clients can replace it with their own names. */
export const DEFAULT_ANGLES = ["pain_point", "social_proof", "demo", "offer_led", "ugc", "testimonial", "educational"];
