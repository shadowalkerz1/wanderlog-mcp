import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import { resolveInsertPosition, resolveLmPosition } from "../resolvers/position.js";
import type { Section, TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";
import {
  findDaySectionByDate,
  findListSectionByHeading,
  findPlacesToVisitSection,
  submitOp,
} from "./shared.js";

export const movePlaceInputSchema = {
  trip_key: z.string().min(1).describe("The trip to modify."),
  place_ref: z
    .string()
    .min(1)
    .describe(
      "Natural-language reference to the place to move or copy. Same syntax as wanderlog_remove_place: exact or partial name, role keywords ('the hotel'), ordinal prefix ('2nd Cafe'), day filter ('Museum on day 2').",
    ),
  to: z
    .string()
    .min(1)
    .describe(
      "Destination section. Use 'day 1', 'day 2', 'May 15', '2026-05-15' for day sections; a list heading like 'Coffee places' for custom lists; or 'places to visit' for the default list.",
    ),
  position: z
    .string()
    .optional()
    .describe(
      "Where within the destination section to place the block. 'first', 'last' (default), a 1-based number like '2', 'before <name>', or 'after <name>'.",
    ),
  copy: z
    .boolean()
    .optional()
    .describe(
      "If true, copy the block to the destination without removing it from the source. Defaults to false (move).",
    ),
};

export const movePlaceDescription = `
Moves or copies a place block to a different position or section within a Wanderlog trip.

Destination ("to") can be:
  - A day: "day 1", "May 15", "2026-05-15"
  - A custom list: "Coffee places", "Temples"
  - The default list: "places to visit"

Position within the destination:
  - "first", "last" (default), "2" (1-based), "before Museum", "after Cafe"

Set copy: true to duplicate without removing the original.
`.trim();

type Args = {
  trip_key: string;
  place_ref: string;
  to: string;
  position?: string;
  copy?: boolean;
};

function findDestSection(
  trip: TripPlan,
  to: string,
): { index: number; section: Section } | null {
  try {
    const daySection = resolveDay(trip, to);
    const found = findDaySectionByDate(trip, daySection.date!);
    if (found) return found;
  } catch {
    // not a day ref — fall through
  }

  if (/^places to visit$/i.test(to)) {
    return findPlacesToVisitSection(trip);
  }

  return findListSectionByHeading(trip, to);
}

function formatLocation(section: Section): string {
  if (section.mode === "dayPlan" && section.date) return `day ${section.date}`;
  if (section.heading) return `"${section.heading}"`;
  return `"${section.type}"`;
}

export async function movePlace(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const refResult = resolvePlaceRef(trip, args.place_ref);

    if (refResult.kind === "none") {
      throw new WanderlogNotFoundError("Place", args.place_ref);
    }

    if (refResult.kind === "ambiguous") {
      const lines = refResult.candidates
        .slice(0, 10)
        .map((c, i) => {
          const name = isPlaceBlock(c.block) ? c.block.place.name : `${c.block.type} block`;
          const where = formatLocation(c.section);
          return `  ${i + 1}. ${name} — ${where}`;
        })
        .join("\n");

      const first = refResult.candidates[0]!;
      const firstName = isPlaceBlock(first.block) ? first.block.place.name : "the block";
      return {
        content: [
          {
            type: "text",
            text: `"${args.place_ref}" matches ${refResult.candidates.length} places:\n${lines}\n\nCall again with an ordinal, e.g. place_ref: "1st ${firstName}".`,
          },
        ],
        isError: true,
      };
    }

    const {
      sectionIndex: sourceSectionIdx,
      blockIndex: sourceBlockIdx,
      block,
      section: sourceSection,
    } = refResult.match;

    const dest = findDestSection(trip, args.to);
    if (!dest) {
      throw new WanderlogValidationError(
        `Destination '${args.to}' not found in trip "${trip.title}". Use a day reference, a list heading, or "places to visit".`,
      );
    }

    const { index: destSectionIdx, section: destSection } = dest;
    const isSameSection = sourceSectionIdx === destSectionIdx;
    const isCopy = args.copy === true;
    const blockName = isPlaceBlock(block) ? block.place.name : `${block.type} block`;

    let ops: Json0Op[];
    let text: string;

    if (isSameSection && !isCopy) {
      const toIdx = resolveLmPosition(destSection.blocks, args.position, sourceBlockIdx);
      ops = [
        { p: ["itinerary", "sections", sourceSectionIdx, "blocks", sourceBlockIdx], lm: toIdx },
      ];
      text = `Moved ${blockName} to position ${toIdx + 1} within ${formatLocation(sourceSection)} in "${trip.title}".`;
    } else if (isCopy) {
      const insertIdx = resolveInsertPosition(destSection.blocks, args.position);
      ops = [
        { p: ["itinerary", "sections", destSectionIdx, "blocks", insertIdx], li: block },
      ];
      text = `Copied ${blockName} to ${formatLocation(destSection)} in "${trip.title}".`;
    } else {
      const insertIdx = resolveInsertPosition(destSection.blocks, args.position);
      ops = [
        { p: ["itinerary", "sections", sourceSectionIdx, "blocks", sourceBlockIdx], ld: block },
        { p: ["itinerary", "sections", destSectionIdx, "blocks", insertIdx], li: block },
      ];
      text = `Moved ${blockName} from ${formatLocation(sourceSection)} to ${formatLocation(destSection)} in "${trip.title}".`;
    }

    await submitOp(ctx, args.trip_key, ops);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
