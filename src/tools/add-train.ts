import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { TripPlan } from "../types.js";
import { resolveDay } from "../resolvers/day.js";
import { buildTrainBlock, findTransitSection, submitOp } from "./shared.js";

export const addTrainInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the train to."),
  carrier: z.string().optional().describe("Train carrier name, e.g. 'JR East', 'Eurostar'."),
  depart_station: z
    .string()
    .optional()
    .describe("Departure station name, e.g. 'Tokyo Station'."),
  depart_date: z
    .string()
    .optional()
    .describe("Departure date as ISO date (2026-05-15) or natural language (day 1, May 15)."),
  depart_time: z.string().optional().describe("Departure time in HH:mm format (07:00)."),
  arrive_station: z
    .string()
    .optional()
    .describe("Arrival station name, e.g. 'Kyoto Station'."),
  arrive_date: z
    .string()
    .optional()
    .describe("Arrival date as ISO date (2026-05-15) or natural language (day 1, May 15)."),
  arrive_time: z.string().optional().describe("Arrival time in HH:mm format (09:30)."),
  confirmation_number: z.string().optional().describe("Train confirmation/booking number."),
  traveler_names: z.string().array().optional().describe("Names of travelers on this train."),
};

export const addTrainDescription = `
Adds a train to a Wanderlog trip. The trip must have a transit section already.

Pass any combination of carrier, stations, dates, and times. All fields are optional.
Dates can be ISO format (2026-05-15) or natural language (day 1, May 15).

Returns confirmation with the train details and trip name.
`.trim();

type Args = {
  trip_key: string;
  carrier?: string;
  depart_station?: string;
  depart_date?: string;
  depart_time?: string;
  arrive_station?: string;
  arrive_date?: string;
  arrive_time?: string;
  confirmation_number?: string;
  traveler_names?: string[];
};

/**
 * Resolve a train date string:
 * - If already ISO format (YYYY-MM-DD), return as-is
 * - Otherwise try resolveDay, and return its .date
 * - If resolveDay throws, return the string as-is (train may be outside trip range)
 */
function resolveTrainDate(trip: TripPlan, dateStr?: string): string | undefined {
  if (!dateStr) return undefined;

  // Check if already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try to resolve as a day reference
  try {
    const section = resolveDay(trip, dateStr);
    return section.date ?? undefined;
  } catch {
    // If resolveDay fails, use the string as-is
    // (train might be before/after trip dates)
    return dateStr;
  }
}

export async function addTrain(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const transitSection = findTransitSection(trip);
    if (!transitSection) {
      throw new WanderlogError(
        "This trip has no transit section. Add one in the Wanderlog app first, then retry.",
        "no_transit_section",
      );
    }

    // Resolve dates
    const resolvedDepartDate = resolveTrainDate(trip, args.depart_date);
    const resolvedArriveDate = resolveTrainDate(trip, args.arrive_date);

    // Build the train block
    const block = buildTrainBlock({
      carrier: args.carrier,
      depart_station: args.depart_station,
      depart_date: resolvedDepartDate,
      depart_time: args.depart_time,
      arrive_station: args.arrive_station,
      arrive_date: resolvedArriveDate,
      arrive_time: args.arrive_time,
      confirmation_number: args.confirmation_number,
      traveler_names: args.traveler_names,
    });

    // Build the li op to append to transit section
    const insertIdx = transitSection.section.blocks.length;
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", transitSection.index, "blocks", insertIdx],
        li: block,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    // Build response message
    let text = "Added train";

    if (args.carrier) {
      text = `Added ${args.carrier}`;
    }

    if (args.depart_station && args.arrive_station) {
      text += ` (${args.depart_station} → ${args.arrive_station}`;
      if (resolvedDepartDate) text += `, ${resolvedDepartDate}`;
      if (args.depart_time) text += ` ${args.depart_time}`;
      if (resolvedArriveDate && resolvedArriveDate !== resolvedDepartDate) {
        text += ` → ${resolvedArriveDate}`;
      }
      if (args.arrive_time) text += ` ${args.arrive_time}`;
      text += ")";
    }

    text += ` to "${trip.title}".`;

    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
