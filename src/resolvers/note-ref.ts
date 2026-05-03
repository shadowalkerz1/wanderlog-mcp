import type { NoteBlock, QuillDelta, Section, TripPlan } from "../types.js";
import { parseOrdinal } from "./place-ref.js";
import { resolveDay } from "./day.js";

export type NoteRefMatch = {
  sectionIndex: number;
  blockIndex: number;
  section: Section;
  block: NoteBlock;
};

export type NoteRefResult =
  | { kind: "unique"; match: NoteRefMatch }
  | { kind: "ambiguous"; candidates: NoteRefMatch[] }
  | { kind: "none" };

const MAX_AMBIGUOUS_CANDIDATES = 10;

function isNoteBlock(block: unknown): block is NoteBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as NoteBlock).type === "note"
  );
}

function extractText(delta: QuillDelta | undefined): string {
  return (delta?.ops ?? [])
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("")
    .replace(/\n$/, "")
    .trim();
}

/**
 * Returns a short display label for a NoteBlock for disambiguation messages.
 */
export function noteBlockLabel(block: NoteBlock): string {
  const text = extractText(block.text);
  if (!text) return "(empty note)";
  return text.length > 50 ? `${text.slice(0, 47)}…` : text;
}

/**
 * Collects all NoteBlock matches from a trip, optionally scoped to a single section.
 */
function collectNoteBlocks(
  trip: TripPlan,
  scopeSection?: Section,
): NoteRefMatch[] {
  const matches: NoteRefMatch[] = [];
  const sections = trip.itinerary.sections;
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]!;
    if (scopeSection && section !== scopeSection) continue;
    for (let bi = 0; bi < section.blocks.length; bi++) {
      const block = section.blocks[bi]!;
      if (isNoteBlock(block)) {
        matches.push({ sectionIndex: si, blockIndex: bi, section, block });
      }
    }
  }
  return matches;
}

/**
 * Attempts to strip a trailing " on <day>" context clause from a ref.
 * Returns { body, scopeSection } where scopeSection is null if no clause found.
 */
function stripDayClause(
  trip: TripPlan,
  ref: string,
): { body: string; scopeSection: Section | null } {
  const idx = ref.lastIndexOf(" on ");
  if (idx < 0) return { body: ref, scopeSection: null };

  const contextStr = ref.slice(idx + 4).trim();
  const body = ref.slice(0, idx).trim();

  try {
    const section = resolveDay(trip, contextStr);
    return { body, scopeSection: section };
  } catch {
    return { body: ref, scopeSection: null };
  }
}

function finalize(candidates: NoteRefMatch[]): NoteRefResult {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "unique", match: candidates[0]! };
  return {
    kind: "ambiguous",
    candidates: candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES),
  };
}

/**
 * Resolves a natural-language reference to a NoteBlock in a trip.
 *
 * Supported forms:
 *   - "note"                        → all note blocks (trip-wide)
 *   - "1st note"                    → first note block in the trip
 *   - "last note on day 2"          → last note block in day 2
 *   - "note about the buses"        → note whose text contains "buses"
 *   - "2nd note mentioning subway"  → second note whose text contains "subway"
 */
export function resolveNoteRef(trip: TripPlan, ref: string): NoteRefResult {
  const normalized = ref.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return { kind: "none" };

  const ordinal = parseOrdinal(normalized);
  const withoutOrdinal = ordinal ? ordinal.rest : normalized;

  const { body, scopeSection } = stripDayClause(trip, withoutOrdinal);

  // Strip leading "note" keyword if present, leaving any content filter
  const contentFilter = body.replace(/^note\s*/, "").trim();

  const pool = collectNoteBlocks(trip, scopeSection ?? undefined);

  const candidates =
    contentFilter
      ? pool.filter((m) =>
          extractText(m.block.text).toLowerCase().includes(contentFilter),
        )
      : pool;

  if (ordinal) {
    if (candidates.length === 0) return { kind: "none" };
    const index =
      ordinal.position === "last" ? candidates.length - 1 : ordinal.position - 1;
    if (index < 0 || index >= candidates.length) return { kind: "none" };
    return { kind: "unique", match: candidates[index]! };
  }

  return finalize(candidates);
}
