import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { noteBlockLabel, resolveNoteRef } from "../resolvers/note-ref.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import { isPlaceBlock } from "../types.js";
import { submitOp } from "./shared.js";

export const editNoteInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip containing the note."),
  place: z
    .string()
    .optional()
    .describe(
      "Natural-language reference to a place whose inline note you want to edit. " +
        "Examples: 'Sensō-ji', '1st Starbucks on day 2'. Provide either this or note_ref, not both.",
    ),
  note_ref: z
    .string()
    .optional()
    .describe(
      "Reference to a standalone note block. Supports ordinals and day scoping. " +
        "Examples: '1st note on day 3', 'last note', 'note about the subway'. " +
        "Provide either this or place, not both.",
    ),
  text: z
    .string()
    .describe(
      "New text for the note. Pass an empty string to clear the note.",
    ),
};

export const editNoteDescription = `
Edits the text of a note in a Wanderlog trip itinerary.

Two kinds of notes can be edited:
  - Inline place notes: the short note attached to a specific place entry. Use the "place"
    parameter with a natural-language place name (same syntax as wanderlog_annotate_place).
  - Standalone notes: free-standing text blocks added between places. Use the "note_ref"
    parameter — supports ordinals and day scoping, e.g. "1st note on day 2", "last note",
    "note about the subway".

Provide exactly one of "place" or "note_ref". Use an empty string for "text" to clear the note.
`.trim();

type Args = {
  trip_key: string;
  place?: string;
  note_ref?: string;
  text: string;
};

export async function editNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const hasPlace = !!args.place;
    const hasNoteRef = !!args.note_ref;

    if (hasPlace && hasNoteRef) {
      throw new WanderlogValidationError(
        "Provide either 'place' or 'note_ref', not both.",
      );
    }
    if (!hasPlace && !hasNoteRef) {
      throw new WanderlogValidationError(
        "One of 'place' or 'note_ref' is required.",
      );
    }

    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    let sectionIndex: number;
    let blockIndex: number;
    let targetLabel: string;

    if (hasPlace) {
      const result = resolvePlaceRef(trip, args.place!);

      if (result.kind === "none") {
        throw new WanderlogError(
          `No place matching "${args.place}" found in "${trip.title}"`,
          "place_ref_not_found",
          {
            hint: "Check the place name or use wanderlog_get_trip to see what's in the itinerary.",
            followUps: [
              `Call wanderlog_get_trip with trip_key "${args.trip_key}" to see all places.`,
            ],
          },
        );
      }
      if (result.kind === "ambiguous") {
        const lines = result.candidates.map((c, i) => {
          const name = isPlaceBlock(c.block)
            ? c.block.place.name
            : `block #${c.block.id}`;
          const loc = c.section.date
            ? `day ${c.section.date}`
            : c.section.heading || "unscheduled";
          return `  ${i + 1}. ${name} (${loc})`;
        });
        const text = `Multiple places match "${args.place}":\n${lines.join("\n")}\n\nRetry with a more specific reference or an ordinal prefix.`;
        return { content: [{ type: "text", text }] };
      }

      if (!isPlaceBlock(result.match.block)) {
        throw new WanderlogError(
          `"${args.place}" resolved to a non-place block. Use note_ref for standalone notes.`,
          "wrong_block_type",
        );
      }

      sectionIndex = result.match.sectionIndex;
      blockIndex = result.match.blockIndex;
      targetLabel = result.match.block.place.name;
    } else {
      const result = resolveNoteRef(trip, args.note_ref!);

      if (result.kind === "none") {
        throw new WanderlogError(
          `No note matching "${args.note_ref}" found in "${trip.title}"`,
          "note_ref_not_found",
          {
            hint: "Use wanderlog_get_trip to see existing notes, or try a broader reference like '1st note on day X'.",
            followUps: [
              `Call wanderlog_get_trip with trip_key "${args.trip_key}" to see all notes.`,
            ],
          },
        );
      }
      if (result.kind === "ambiguous") {
        const lines = result.candidates.map((c, i) => {
          const preview = noteBlockLabel(c.block);
          const loc = c.section.date
            ? `day ${c.section.date}`
            : c.section.heading || "unscheduled";
          return `  ${i + 1}. "${preview}" (${loc})`;
        });
        const text = `Multiple notes match "${args.note_ref}":\n${lines.join("\n")}\n\nRetry with a more specific reference or an ordinal prefix (e.g. "1st note on day X").`;
        return { content: [{ type: "text", text }] };
      }

      sectionIndex = result.match.sectionIndex;
      blockIndex = result.match.blockIndex;
      targetLabel = noteBlockLabel(result.match.block) || "note";
    }

    const blockPath = ["itinerary", "sections", sectionIndex, "blocks", blockIndex];
    const ops: Json0Op[] = [
      {
        p: [...blockPath, "text"],
        t: "rich-text",
        o: [{ insert: args.text ? `${args.text}\n` : "\n" }],
      },
    ];
    await submitOp(ctx, args.trip_key, ops);

    const action = args.text ? "Updated" : "Cleared";
    const preview =
      args.text.length > 60 ? `${args.text.slice(0, 57)}…` : args.text;
    const detail = args.text ? ` Note: "${preview}"` : "";
    const text = `${action} note on "${targetLabel}" in "${trip.title}".${detail}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
