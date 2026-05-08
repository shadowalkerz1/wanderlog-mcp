import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { PlaceData } from "../types.js";
import {
  buildPlaceBlock,
  findHotelsSection,
  findTripCenter,
  requireUserId,
  submitOp,
} from "./shared.js";

export const addHotelInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the hotel to."),
  hotel: z
    .string()
    .min(1)
    .describe(
      "Hotel name to search for. Examples: 'Park Hyatt Tokyo', 'the cheap hostel near the train station'. Matched against Google Places near the trip's destination.",
    ),
  check_in: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Check-in date, YYYY-MM-DD."),
  check_out: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Check-out date, YYYY-MM-DD. Must be after check_in."),
  confirmation_number: z
    .string()
    .optional()
    .describe("Optional booking confirmation / reference number."),
  traveler_names: z
    .array(z.string())
    .optional()
    .describe("Optional list of guest names for this booking."),
  check_in_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("Optional check-in time in HH:mm format (e.g. '15:00')."),
  check_out_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("Optional check-out time in HH:mm format (e.g. '11:00')."),
};

export const addHotelDescription = `
Adds a hotel booking to a Wanderlog trip with check-in and check-out dates. If the trip does
not yet have a "Hotels and lodging" section, one is created automatically.

Returns confirmation with the resolved hotel name and the booking window.
`.trim();

type Args = {
  trip_key: string;
  hotel: string;
  check_in: string;
  check_out: string;
  confirmation_number?: string;
  traveler_names?: string[];
  check_in_time?: string;
  check_out_time?: string;
};

export async function addHotel(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    if (args.check_out <= args.check_in) {
      throw new WanderlogValidationError(
        `check_out (${args.check_out}) must be after check_in (${args.check_in})`,
      );
    }

    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const center = findTripCenter(trip, entry.geos);
    if (!center) {
      throw new WanderlogValidationError(
        `Cannot add hotel to "${trip.title}" because no location anchor is available`,
        "This trip has no associated geo and no existing places.",
      );
    }

    const predictions = await ctx.rest.searchPlacesAutocomplete({
      input: args.hotel,
      sessionToken: crypto.randomUUID(),
      location: { latitude: center.lat, longitude: center.lng },
      radius: 15000,
    });
    if (predictions.length === 0) {
      throw new WanderlogError(
        `No hotel found matching "${args.hotel}" near ${trip.title}`,
        "hotel_not_found",
        "Try a more specific name or check the spelling.",
      );
    }
    const detail: PlaceData = await ctx.rest.getPlaceDetails(predictions[0]!.place_id);

    const block = buildPlaceBlock(detail, userId, {
      hotel: {
        checkIn: args.check_in,
        checkOut: args.check_out,
        travelerNames: args.traveler_names ?? [],
        confirmationNumber: args.confirmation_number ?? null,
      },
    });

    const existing = findHotelsSection(trip);

    let sectionIndex: number;
    let blockIndex: number;
    let mainOps: Json0Op[];

    if (existing) {
      sectionIndex = existing.index;
      blockIndex = existing.section.blocks.length;
      mainOps = [
        {
          p: ["itinerary", "sections", sectionIndex, "blocks", blockIndex],
          li: block,
        },
      ];
    } else {
      sectionIndex = 1;
      blockIndex = 0;
      mainOps = [
        {
          // Insert a new hotels section after the Notes section (index 1).
          // The existing sections shift down by 1.
          p: ["itinerary", "sections", 1],
          li: {
            id: Math.floor(Math.random() * 1_000_000_000),
            type: "hotels",
            mode: "placeList",
            heading: "Hotels and lodging",
            date: null,
            blocks: [block],
            placeMarkerColor: "#7045af",
            placeMarkerIcon: "bed",
            text: { ops: [{ insert: "\n" }] },
          },
        },
      ];
    }

    await submitOp(ctx, args.trip_key, mainOps);

    // Follow-up ops for check_in_time and check_out_time. The block was inserted
    // without timing fields, so we use oi (object insert) — the key doesn't exist
    // yet. This matches the Wanderlog UI's two-step pattern (same as add-place).
    if (args.check_in_time || args.check_out_time) {
      const blockPath = ["itinerary", "sections", sectionIndex, "blocks", blockIndex];
      const timeOps: Json0Op[] = [];
      if (args.check_in_time) {
        timeOps.push({ p: [...blockPath, "startTime"], oi: args.check_in_time });
      }
      if (args.check_out_time) {
        timeOps.push({ p: [...blockPath, "endTime"], oi: args.check_out_time });
      }
      await submitOp(ctx, args.trip_key, timeOps);
    }

    const checkInDisplay = args.check_in_time
      ? `${args.check_in} (${args.check_in_time})`
      : args.check_in;
    const checkOutDisplay = args.check_out_time
      ? `${args.check_out} (${args.check_out_time})`
      : args.check_out;

    let text = `Added ${detail.name} to "${trip.title}" · check-in ${checkInDisplay} → check-out ${checkOutDisplay}.`;
    if (args.confirmation_number) {
      text += ` Confirmation: ${args.confirmation_number}.`;
    }

    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
