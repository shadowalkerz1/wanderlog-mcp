import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { noteBlockLabel, resolveNoteRef } from "../resolvers/note-ref.js";
import { quillPlainText, submitOp } from "./shared.js";

export const editNoteInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip containing the note."),
  note_ref: z
    .string()
    .min(1)
    .describe(
      "Reference to a standalone note block added by wanderlog_add_note. " +
        "Supports ordinals and day scoping. " +
        "Examples: '1st note on day 3', 'last note', 'note about the subway'. " +
        "To edit the inline note on a place entry, use wanderlog_annotate_place instead.",
    ),
  text: z
    .string()
    .describe(
      "New text for the note. Pass an empty string to clear the note.",
    ),
};

export const editNoteDescription = `
Edits the text of a standalone note block in a Wanderlog trip — the kind added between
places by wanderlog_add_note.

Use "note_ref" to identify which note to edit. Supports ordinals and day scoping:
"1st note on day 2", "last note", "note about the subway".

To edit the inline note attached to a place entry, use wanderlog_annotate_place instead.

Pass an empty string for "text" to clear the note.
`.trim();

type Args = {
  trip_key: string;
  note_ref: string;
  text: string;
};

export async function editNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const result = resolveNoteRef(trip, args.note_ref);

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

    const { sectionIndex, blockIndex, block } = result.match;
    const blockPath = ["itinerary", "sections", sectionIndex, "blocks", blockIndex];

    // Replace the existing content: delete it first so we don't prepend.
    const existingText = quillPlainText(block.text);
    const newContent = args.text ? `${args.text}\n` : "\n";
    const deltaOps = existingText.length > 0
      ? [{ delete: existingText.length }, { insert: newContent }]
      : [{ insert: newContent }];

    const ops: Json0Op[] = [
      {
        p: [...blockPath, "text"],
        t: "rich-text",
        o: deltaOps,
      },
    ];
    await submitOp(ctx, args.trip_key, ops);

    const action = args.text ? "Updated" : "Cleared";
    const targetLabel = noteBlockLabel(block) || "note";
    const preview = args.text.length > 60 ? `${args.text.slice(0, 57)}…` : args.text;
    const detail = args.text ? ` Note: "${preview}"` : "";
    const text = `${action} note "${targetLabel}" in "${trip.title}".${detail}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
