import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import {
  addChecklist,
  addChecklistDescription,
  addChecklistInputSchema,
} from "./tools/add-checklist.js";
import {
  addExpense,
  addExpenseDescription,
  addExpenseInputSchema,
} from "./tools/add-expense.js";
import {
  annotatePlace,
  annotatePlaceDescription,
  annotatePlaceInputSchema,
} from "./tools/annotate-place.js";
import {
  addHotel,
  addHotelDescription,
  addHotelInputSchema,
} from "./tools/add-hotel.js";
import {
  addNote,
  addNoteDescription,
  addNoteInputSchema,
} from "./tools/add-note.js";
import {
  addPlace,
  addPlaceDescription,
  addPlaceInputSchema,
} from "./tools/add-place.js";
import {
  createTrip,
  createTripDescription,
  createTripInputSchema,
} from "./tools/create-trip.js";
import {
  getTrip,
  getTripDescription,
  getTripInputSchema,
} from "./tools/get-trip.js";
import {
  listTrips,
  listTripsDescription,
  listTripsInputSchema,
} from "./tools/list-trips.js";
import {
  removePlace,
  removePlaceDescription,
  removePlaceInputSchema,
} from "./tools/remove-place.js";
import {
  searchPlaces,
  searchPlacesDescription,
  searchPlacesInputSchema,
} from "./tools/search-places.js";
import {
  updateTripDates,
  updateTripDatesDescription,
  updateTripDatesInputSchema,
} from "./tools/update-trip-dates.js";
import {
  renameDay,
  renameDayDescription,
  renameDayInputSchema,
} from "./tools/rename-day.js";
import {
  editNote,
  editNoteDescription,
  editNoteInputSchema,
} from "./tools/edit-note.js";
import {
  movePlace,
  movePlaceDescription,
  movePlaceInputSchema,
} from "./tools/move-place.js";
import {
  addFlight,
  addFlightDescription,
  addFlightInputSchema,
} from "./tools/add-flight.js";
import {
  addTrain,
  addTrainDescription,
  addTrainInputSchema,
} from "./tools/add-train.js";

const AUTH_ERROR_RESPONSE = {
  content: [
    {
      type: "text" as const,
      text: "Authentication required. Update WANDERLOG_COOKIE with a valid connect.sid cookie from wanderlog.com and restart the server.",
    },
  ],
  isError: true,
};

function requireAuth(
  ctx: AppContext,
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>,
) {
  return async (args: Record<string, unknown>) => {
    if (!ctx.authenticated) return AUTH_ERROR_RESPONSE;
    return handler(args);
  };
}

const SERVER_INSTRUCTIONS = `
You are connected to Wanderdog, an MCP server for building Wanderlog trip itineraries.

When a user asks you to create an itinerary or plan a trip, build it in full — not just a list
of places. A complete itinerary uses these building blocks:

  1. wanderlog_add_place — 3-5 places per day (attractions, restaurants, activities).
     ALWAYS use the "note" parameter to attach practical context directly to the place: how to
     get there, what to order, booking tips, opening hours. ALWAYS use "start_time" and
     "end_time" to schedule each place (e.g. start_time: "09:00", end_time: "10:30").
     This is one tool call instead of two — faster and the note lives on the place itself.
  2. wanderlog_add_note — use ONLY for freestanding commentary between places: neighborhood
     context, multi-stop transit directions, or day-level tips not about a specific place.
     Do NOT use add_note for per-place context — use the "note" param on add_place instead.
  3. wanderlog_add_hotel — one hotel block covering the full stay. Include check_in_time,
     check_out_time, and confirmation_number when the user provides them.
  4. wanderlog_add_flight — add a flight block when the user mentions flight details (airline,
     airports, times). All fields are optional — add what you know.
  5. wanderlog_add_train — add a train block for rail legs (carrier, stations, times).
  6. wanderlog_add_checklist — at least one pre-trip checklist (visa, currency, offline maps,
     return ticket, travel insurance) and per-day checklists for days that need advance prep
  7. wanderlog_add_expense — add estimated costs for meals, entrance fees, transport passes.
     Link each expense to its place for budget tracking.
  8. wanderlog_annotate_place — set or replace the inline note, start/end time, or all three
     on a place already in the itinerary. This is the ONLY tool for editing place notes.
  9. wanderlog_edit_note — edit or clear the text of a standalone note block (the kind added
     by wanderlog_add_note). Do NOT use this for place notes — use annotate_place instead.
 10. wanderlog_move — move or copy ANY block (place, hotel, flight, train) to a different day,
     list, or position. Use when the user asks to reorder, reschedule, or duplicate a block.
 11. wanderlog_remove — remove ANY block (place, hotel, flight, train) from the itinerary.

Example add_place call with all features:
  wanderlog_add_place(trip_key, place: "Sensō-ji", day: "day 1",
    note: "Arrive before 9am to avoid crowds. Free entry. The Nakamise shopping street
    leading to the temple is great for souvenirs and snacks.",
    start_time: "08:30", end_time: "10:00")

Places without notes and times are just pins on a map. Rich places make an itinerary useful.
`.trim();

export function buildServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: "wanderlog-mcp", version: "0.4.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "wanderlog_list_trips",
    {
      title: "List Wanderlog trips",
      description: listTripsDescription,
      inputSchema: listTripsInputSchema,
    },
    requireAuth(ctx, async (args) => listTrips(ctx, args as Parameters<typeof listTrips>[1])),
  );

  server.registerTool(
    "wanderlog_get_trip",
    {
      title: "Get a Wanderlog trip",
      description: getTripDescription,
      inputSchema: getTripInputSchema,
    },
    requireAuth(ctx, async (args) => getTrip(ctx, args as Parameters<typeof getTrip>[1])),
  );

  server.registerTool(
    "wanderlog_search_places",
    {
      title: "Search places near a Wanderlog trip",
      description: searchPlacesDescription,
      inputSchema: searchPlacesInputSchema,
    },
    requireAuth(ctx, async (args) => searchPlaces(ctx, args as Parameters<typeof searchPlaces>[1])),
  );

  server.registerTool(
    "wanderlog_create_trip",
    {
      title: "Create a Wanderlog trip",
      description: createTripDescription,
      inputSchema: createTripInputSchema,
    },
    requireAuth(ctx, async (args) => createTrip(ctx, args as Parameters<typeof createTrip>[1])),
  );

  server.registerTool(
    "wanderlog_add_place",
    {
      title: "Add a place to a Wanderlog trip",
      description: addPlaceDescription,
      inputSchema: addPlaceInputSchema,
    },
    requireAuth(ctx, async (args) => addPlace(ctx, args as Parameters<typeof addPlace>[1])),
  );

  server.registerTool(
    "wanderlog_move",
    {
      title: "Move or copy any block to a different section in a Wanderlog trip",
      description: movePlaceDescription,
      inputSchema: movePlaceInputSchema,
    },
    requireAuth(ctx, async (args) =>
      movePlace(ctx, args as Parameters<typeof movePlace>[1])),
  );

  server.registerTool(
    "wanderlog_add_hotel",
    {
      title: "Add a hotel booking to a Wanderlog trip",
      description: addHotelDescription,
      inputSchema: addHotelInputSchema,
    },
    requireAuth(ctx, async (args) => addHotel(ctx, args as Parameters<typeof addHotel>[1])),
  );

  server.registerTool(
    "wanderlog_add_flight",
    {
      title: "Add a flight to a Wanderlog trip",
      description: addFlightDescription,
      inputSchema: addFlightInputSchema,
    },
    requireAuth(ctx, async (args) =>
      addFlight(ctx, args as Parameters<typeof addFlight>[1])),
  );

  server.registerTool(
    "wanderlog_add_train",
    {
      title: "Add a train to a Wanderlog trip",
      description: addTrainDescription,
      inputSchema: addTrainInputSchema,
    },
    requireAuth(ctx, async (args) =>
      addTrain(ctx, args as Parameters<typeof addTrain>[1])),
  );

  server.registerTool(
    "wanderlog_add_note",
    {
      title: "Add a note to a Wanderlog trip",
      description: addNoteDescription,
      inputSchema: addNoteInputSchema,
    },
    requireAuth(ctx, async (args) => addNote(ctx, args as Parameters<typeof addNote>[1])),
  );

  server.registerTool(
    "wanderlog_add_checklist",
    {
      title: "Add a checklist to a Wanderlog trip",
      description: addChecklistDescription,
      inputSchema: addChecklistInputSchema,
    },
    requireAuth(ctx, async (args) => addChecklist(ctx, args as Parameters<typeof addChecklist>[1])),
  );

  server.registerTool(
    "wanderlog_annotate_place",
    {
      title: "Update a place with notes, times, or both",
      description: annotatePlaceDescription,
      inputSchema: annotatePlaceInputSchema,
    },
    requireAuth(ctx, async (args) =>
      annotatePlace(ctx, args as Parameters<typeof annotatePlace>[1])),
  );

  server.registerTool(
    "wanderlog_add_expense",
    {
      title: "Add a budget expense to a Wanderlog trip",
      description: addExpenseDescription,
      inputSchema: addExpenseInputSchema,
    },
    requireAuth(ctx, async (args) =>
      addExpense(ctx, args as Parameters<typeof addExpense>[1])),
  );

  server.registerTool(
    "wanderlog_remove",
    {
      title: "Remove any block from a Wanderlog trip",
      description: removePlaceDescription,
      inputSchema: removePlaceInputSchema,
    },
    requireAuth(ctx, async (args) => removePlace(ctx, args as Parameters<typeof removePlace>[1])),
  );

  server.registerTool(
    "wanderlog_update_trip_dates",
    {
      title: "Update a Wanderlog trip's date range",
      description: updateTripDatesDescription,
      inputSchema: updateTripDatesInputSchema,
    },
    requireAuth(ctx, async (args) =>
      updateTripDates(ctx, args as Parameters<typeof updateTripDates>[1])),
  );

  server.registerTool(
    "wanderlog_rename_day",
    {
      title: "Rename a day heading in a Wanderlog trip",
      description: renameDayDescription,
      inputSchema: renameDayInputSchema,
    },
    requireAuth(ctx, async (args) =>
      renameDay(ctx, args as Parameters<typeof renameDay>[1])),
  );

  server.registerTool(
    "wanderlog_edit_note",
    {
      title: "Edit a note in a Wanderlog trip",
      description: editNoteDescription,
      inputSchema: editNoteInputSchema,
    },
    requireAuth(ctx, async (args) =>
      editNote(ctx, args as Parameters<typeof editNote>[1])),
  );

  return server;
}
