import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import { buildFlightBlock, findFlightsSection, submitOp } from "./shared.js";

export const addFlightInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the flight to."),
  airline: z.string().optional().describe("Airline name, e.g. 'Singapore Airlines'."),
  flight_number: z.string().optional().describe("Flight number, e.g. 'SQ 321'."),
  depart_airport: z
    .string()
    .optional()
    .describe("Departure airport as IATA code (SIN) or city name (Singapore)."),
  depart_date: z
    .string()
    .optional()
    .describe("Departure date as ISO date (2026-05-15) or natural language (day 1, May 15)."),
  depart_time: z.string().optional().describe("Departure time in HH:mm format (09:00)."),
  arrive_airport: z
    .string()
    .optional()
    .describe("Arrival airport as IATA code (NRT) or city name (Tokyo)."),
  arrive_date: z
    .string()
    .optional()
    .describe("Arrival date as ISO date (2026-05-15) or natural language (day 1, May 15)."),
  arrive_time: z.string().optional().describe("Arrival time in HH:mm format (17:30)."),
  confirmation_number: z.string().optional().describe("Flight confirmation/booking number."),
  traveler_names: z.string().array().optional().describe("Names of travelers on this flight."),
};

export const addFlightDescription = `
Adds a flight to a Wanderlog trip. The trip must have a flights section already.

Pass any combination of airline, flight number, airports, dates, and times. All fields are optional.
Dates can be ISO format (2026-05-15) or natural language (day 1, May 15).

Returns confirmation with the flight details and trip name.
`.trim();

type Args = {
  trip_key: string;
  airline?: string;
  flight_number?: string;
  depart_airport?: string;
  depart_date?: string;
  depart_time?: string;
  arrive_airport?: string;
  arrive_date?: string;
  arrive_time?: string;
  confirmation_number?: string;
  traveler_names?: string[];
};

/**
 * Resolve a flight date string:
 * - If already ISO format (YYYY-MM-DD), return as-is
 * - Otherwise try resolveDay, and return its .date
 * - If resolveDay throws, return the string as-is (flight may be outside trip range)
 */
function resolveFlightDate(trip: any, dateStr?: string): string | undefined {
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
    // (flight might be before/after trip dates)
    return dateStr;
  }
}

export async function addFlight(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const flightsSection = findFlightsSection(trip);
    if (!flightsSection) {
      throw new WanderlogError(
        "This trip has no flights section. Add one in the Wanderlog app first, then retry.",
        "no_flights_section",
      );
    }

    // Resolve dates
    const resolvedDepartDate = resolveFlightDate(trip, args.depart_date);
    const resolvedArriveDate = resolveFlightDate(trip, args.arrive_date);

    // Build the flight block
    const block = buildFlightBlock({
      airline: args.airline,
      flight_number: args.flight_number,
      depart_airport: args.depart_airport,
      depart_date: resolvedDepartDate,
      depart_time: args.depart_time,
      arrive_airport: args.arrive_airport,
      arrive_date: resolvedArriveDate,
      arrive_time: args.arrive_time,
      confirmation_number: args.confirmation_number,
      traveler_names: args.traveler_names,
    });

    // Build the li op to append to flights section
    const insertIdx = flightsSection.section.blocks.length;
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", flightsSection.index, "blocks", insertIdx],
        li: block,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    // Build response message
    let text = "Added flight";

    if (args.airline && args.flight_number) {
      text = `Added ${args.airline} ${args.flight_number}`;
    } else if (args.airline) {
      text = `Added ${args.airline}`;
    } else if (args.flight_number) {
      text = `Added flight ${args.flight_number}`;
    }

    if (args.depart_airport && args.arrive_airport) {
      text += ` (${args.depart_airport} → ${args.arrive_airport}`;
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
