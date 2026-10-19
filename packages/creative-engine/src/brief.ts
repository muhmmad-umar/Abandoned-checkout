import type { ScalingBrief } from "@ad-scaler/shared";
import { patternLabel } from "./labels";
import type { BriefItem, CreativeBrief, FatiguedCreative, LengthBucket, Pattern, PatternDimension, WinningPatterns } from "./types";

export interface BuildBriefOptions {
  /** High-potential angles to test this cycle (from findUntestedAngles). */
  untestedAngles?: string[];
}

const pick = (patterns: Pattern[], d: PatternDimension) => patterns.filter((p) => p.dimension === d);

/** Top patterns for the headline: best first, at most one per dimension. */
export function headlinePatterns(top: Pattern[], n = 3): Pattern[] {
  const seen = new Set<PatternDimension>();
  const out: Pattern[] = [];
  for (const p of top) {
    if (seen.has(p.dimension)) continue;
    seen.add(p.dimension);
    out.push(p);
    if (out.length === n) break;
  }
  return out;
}

function evidence(p: Pattern): string {
  return `${p.label} — ${p.count} of your top ${p.quartileSize} creatives, avg score ${p.avgScore}`;
}

/**
 * Builds the creative brief: the winning patterns, how many creatives to make, one card per
 * creative (format, angle, rationale, what to avoid, priority) and what to retire.
 * Order of cards: replacements for fatigued creatives (highest spend first), then volume to
 * reach the recommended minimum, then tests of untested angles.
 * Only formats the client said they can produce are suggested.
 */
export function buildBrief(
  patterns: WinningPatterns,
  fatigued: FatiguedCreative[],
  needed: number,
  clientBrief: Pick<ScalingBrief, "formatsAvailable">,
  opts: BuildBriefOptions = {},
): CreativeBrief {
  const available = clientBrief.formatsAvailable;
  const formatPatterns = pick(patterns.top, "format").filter((p) => available.length === 0 || available.includes(p.value as never));
  const formats = formatPatterns.length ? formatPatterns.map((p) => p.value) : available.length ? [...available] : ["static"];
  const anglePatterns = pick(patterns.top, "angle");
  const angles = anglePatterns.length ? anglePatterns.map((p) => p.value) : ["your best-performing angle"];
  const length = (pick(patterns.top, "length")[0]?.value ?? null) as LengthBucket | null;
  const style = pick(patterns.top, "visualStyle")[0]?.value ?? null;
  const tone = pick(patterns.top, "tone")[0]?.value ?? null;
  const lead = patterns.top[0];

  const losing = patterns.losing.slice(0, 2);
  const avoid = losing.length
    ? `Avoid ${losing.map((p) => p.label.toLowerCase()).join(" and ")} — ${losing.length === 1 ? "it shows" : "they show"} up most in your lowest-scoring creatives (${losing.map((p) => `${p.count} of ${p.quartileSize}`).join(", ")}).`
    : "Avoid reusing the exact hooks of the creatives being retired — your audience has already seen them.";

  const untested = (opts.untestedAngles ?? []).slice(0, needed);
  const replacements = fatigued.slice(0, Math.max(0, needed - untested.length));
  const volume = Math.max(0, needed - untested.length - replacements.length);

  const items: BriefItem[] = [];
  const isVideo = (f: string) => f === "video" || f === "ugc";
  const base = (format: string, angle: string): Omit<BriefItem, "priority" | "rationale" | "kind" | "replacesAdId"> => ({
    suggestedFormat: format,
    suggestedAngle: angle,
    suggestedLength: isVideo(format) ? length : null,
    suggestedVisualStyle: style,
    suggestedTone: tone,
    whatToAvoid: avoid,
  });
  const fmtLabel = (f: string) => patternLabel("format", f);
  const angleLabel = (a: string) => (a.startsWith("your ") ? a : patternLabel("angle", a).toLowerCase());

  replacements.forEach((f, i) => {
    const format = formats[i % formats.length]!;
    const angle = angles[i % angles.length]!;
    items.push({
      ...base(format, angle),
      priority: items.length + 1,
      kind: "replacement",
      replacesAdId: f.adId,
      rationale: `Replaces "${f.name}" (${f.reasons[0]!.message.replace(/\.$/, "")}). A ${fmtLabel(format)} with a ${angleLabel(angle)} follows your strongest pattern${lead ? `: ${evidence(lead)}` : ""}.`,
    });
  });
  for (let i = 0; i < volume; i++) {
    const k = replacements.length + i;
    const format = formats[k % formats.length]!;
    const angle = angles[k % angles.length]!;
    const p = formatPatterns[k % Math.max(formatPatterns.length, 1)] ?? lead;
    items.push({
      ...base(format, angle),
      priority: items.length + 1,
      kind: "volume",
      replacesAdId: null,
      rationale: `Adds depth so your budget has more winners to spend into. ${p ? `Based on ${evidence(p)}.` : "Based on your current best performers."}`,
    });
  }
  untested.forEach((angle, i) => {
    const format = formats[0]!;
    items.push({
      ...base(format, angle),
      priority: items.length + 1,
      kind: "exploration",
      replacesAdId: null,
      rationale: `Untested angle: your winning ${fmtLabel(format)} format applied to a ${patternLabel("angle", angle).toLowerCase()}, which you haven't tried yet. It gives you a fresh lever before today's winners fatigue.`,
    });
  });

  const headline3 = headlinePatterns(patterns.top);
  return {
    headline: headline3.length
      ? `Your top ${headline3.length} winning patterns are: ${headline3.map((p) => p.label).join(", ")}`
      : "Not enough scored creatives yet to identify winning patterns",
    summary: needed > 0
      ? `You need ${needed} new ${needed === 1 ? "creative" : "creatives"} this cycle`
      : "Your creative set is healthy — no new creatives needed this cycle",
    topPatterns: headline3,
    creativesNeeded: needed,
    items,
    toRetire: fatigued.map((f) => ({ adId: f.adId, name: f.name, reason: f.reasons.map((r) => r.message).join(" ") })),
  };
}


