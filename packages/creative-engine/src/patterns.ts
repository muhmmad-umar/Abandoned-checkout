import { lengthBucket, patternLabel } from "./labels";
import type { Pattern, PatternDimension, RankedCreative, WinningPatterns } from "./types";

const DIMENSIONS: PatternDimension[] = ["format", "length", "angle", "visualStyle", "tone"];

function valueOf(c: RankedCreative, d: PatternDimension): string | null {
  const a = c.attributes;
  switch (d) {
    case "format": return a.format;
    case "length": return a.format === "video" || a.format === "ugc" ? lengthBucket(a.lengthSec) : null;
    case "angle": return a.angle ?? null;
    case "visualStyle": return a.visualStyle ?? null;
    case "tone": return a.tone ?? null;
  }
}

function patternsIn(group: RankedCreative[], all: RankedCreative[]): Pattern[] {
  const out: Pattern[] = [];
  for (const d of DIMENSIONS) {
    const counts = new Map<string, RankedCreative[]>();
    for (const c of group) {
      const v = valueOf(c, d);
      if (v) counts.set(v, [...(counts.get(v) ?? []), c]);
    }
    for (const [value, members] of counts) {
      const overall = all.filter((c) => valueOf(c, d) === value).length / all.length;
      const share = members.length / group.length;
      out.push({
        dimension: d, value, label: patternLabel(d, value),
        count: members.length, quartileSize: group.length, share,
        lift: overall > 0 ? share / overall : 0,
        avgScore: Math.round(members.reduce((a, c) => a + (c.score ?? 0), 0) / members.length),
      });
    }
  }
  return out;
}

/**
 * Reads what the best creatives have in common: format, length, angle, visual style and tone.
 * Takes the top quartile of scored creatives (at least one) and keeps attribute values that are
 * over-represented there (lift ≥ 1), ranked by share of the quartile, then average score.
 * Losing patterns are the same analysis on the bottom quartile, minus anything in the top set.
 * @param ranked output of scoreCreatives
 */
export function identifyWinningPatterns(ranked: RankedCreative[]): WinningPatterns {
  const scored = ranked.filter((c) => c.score != null).sort((a, b) => b.score! - a.score!);
  if (scored.length === 0) return { top: [], losing: [], topCreativeIds: [] };
  const q = Math.max(1, Math.ceil(scored.length / 4));
  const topGroup = scored.slice(0, q);
  const bottomGroup = scored.length > q ? scored.slice(-q) : [];
  const rank = (a: Pattern, b: Pattern) => b.share - a.share || b.avgScore - a.avgScore || b.lift - a.lift;

  const top = patternsIn(topGroup, scored).filter((p) => p.lift >= 1).sort(rank);
  const topKeys = new Set(top.map((p) => `${p.dimension}:${p.value}`));
  const losing = patternsIn(bottomGroup, scored)
    .filter((p) => p.lift > 1 && !topKeys.has(`${p.dimension}:${p.value}`))
    .sort((a, b) => b.share - a.share || a.avgScore - b.avgScore);
  return { top, losing, topCreativeIds: topGroup.map((c) => c.adId) };
}

/** Angles from the taxonomy that no live creative has tried yet, up to `max`. */
export function findUntestedAngles(taxonomy: string[], ranked: RankedCreative[], max = 2): string[] {
  const tested = new Set(ranked.map((c) => c.attributes.angle).filter(Boolean));
  return taxonomy.filter((a) => !tested.has(a)).slice(0, max);
}
