import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { PlaceSuggestion } from "../types.js";
import { findTripCenter } from "./shared.js";

export const searchPlacesInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe(
      "The trip to scope this search to. Search results are geographically biased toward the trip's destination.",
    ),
  query: z
    .string()
    .min(1)
    .describe(
      "What to search for. Examples: 'sushi restaurant', 'hiking trail', 'coffee near the hotel'.",
    ),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe(
      "Output verbosity. 'concise' lists name + description only; 'detailed' also shows the Google place_id for reference.",
    ),
};

export const searchPlacesDescription = `
Search for real-world places (restaurants, attractions, hotels, parks, landmarks) near the
destination of a Wanderlog trip. Returns candidate results with names and short descriptions.

Use this when the user wants to browse options before committing — e.g. "what sushi restaurants
are near my hotel?" Present the results and let the user choose. Results are geographically
biased toward the trip's location, not global.

To add a specific place to the itinerary, use wanderlog_add_place directly — it does its own
place lookup and does not require a place_id from this tool.
`.trim();

type Args = {
  trip_key: string;
  query: string;
  response_format?: "concise" | "detailed";
};


export async function searchPlaces(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;
    const center = findTripCenter(trip, entry.geos);
    if (!center) {
      throw new WanderlogValidationError(
        "Cannot determine trip location",
        "This trip has no associated geo and no existing places.",
      );
    }

    const predictions = await ctx.rest.searchPlacesAutocomplete({
      input: args.query,
      sessionToken: crypto.randomUUID(),
      location: { latitude: center.lat, longitude: center.lng },
      radius: 15000,
    });

    if (predictions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No results for "${args.query}" near ${trip.title}. Try broadening the query.`,
          },
        ],
      };
    }

    const text = formatPredictions(predictions, args.response_format ?? "concise");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const e =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: e }], isError: true };
  }
}

function formatPredictions(
  predictions: PlaceSuggestion[],
  format: "concise" | "detailed",
): string {
  const top = predictions.slice(0, 8);
  if (format === "concise") {
    return top
      .map((p, i) => {
        const main = p.structured_formatting?.main_text ?? p.description;
        const sub = p.structured_formatting?.secondary_text ?? "";
        return `${i + 1}. ${main}${sub ? ` — ${sub}` : ""}`;
      })
      .join("\n");
  }
  return top
    .map((p, i) => {
      const main = p.structured_formatting?.main_text ?? p.description;
      const sub = p.structured_formatting?.secondary_text ?? "";
      return `${i + 1}. ${main}${sub ? ` — ${sub}` : ""}\n   place_id: ${p.place_id}`;
    })
    .join("\n");
}
