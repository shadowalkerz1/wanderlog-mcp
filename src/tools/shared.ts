import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import type { Block, ChecklistItem, Geo, PlaceData, Section, TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";

/**
 * Per-trip mutex — serializes submits against the same trip so concurrent
 * callers can't race each other on the ShareDB version vector. Without this,
 * parallel Promise.all batches of mutations all read the cache at version N
 * simultaneously and submit stale ops that the server rejects as conflicts.
 */
const submitLocks = new Map<string, Promise<unknown>>();

async function withSubmitLock<T>(
  tripKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = submitLocks.get(tripKey) ?? Promise.resolve();
  // Chain regardless of whether the previous op succeeded or failed —
  // one failed op should not permanently block the queue.
  const next = prev.then(fn, fn);
  // The map always holds a never-rejecting tail so the next caller can chain
  // onto it safely. Dead promises are negligible; the map is keyed by trip.
  submitLocks.set(
    tripKey,
    next.catch(() => {}),
  );
  return next;
}

/**
 * Submit a JSON0 op array to the server and apply it to the live cache on
 * success. Encapsulates the version handshake so tools don't touch
 * ShareDBClient directly.
 *
 * Rules:
 * - Trip must already be in the cache (caller should have called tripCache.get()).
 * - Per-trip mutex: concurrent calls on the same trip serialize automatically.
 * - Op fails atomically: if submit rejects, the cache is invalidated so the
 *   next read refetches a fresh snapshot from the server.
 * - On success, cache.applyLocalOp() is called with the server-accepted version.
 */
export async function submitOp(
  ctx: AppContext,
  tripKey: string,
  ops: Json0Op[],
): Promise<void> {
  return withSubmitLock(tripKey, async () => {
    const client = ctx.pool.get(tripKey);
    if (!client.isSubscribed) {
      throw new WanderlogError(
        `Trip ${tripKey} is not subscribed — call tripCache.get() first`,
        "not_subscribed",
      );
    }
    try {
      await client.submit(ops);
      ctx.tripCache.applyLocalOp(tripKey, ops, client.version);
    } catch (err) {
      // Any submit failure leaves our cached view possibly inconsistent with
      // the server. Invalidate so the next get() refetches + resubscribes.
      ctx.tripCache.invalidate(tripKey);
      throw err;
    }
  });
}

/** Wanderlog block IDs are 9-digit numeric. */
export function generateBlockId(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function requireUserId(ctx: AppContext): number {
  if (ctx.userId == null) {
    throw new WanderlogError(
      "User ID not available — auth probe has not completed",
      "no_user_id",
    );
  }
  return ctx.userId;
}

/**
 * Build a newly-inserted place block matching Wanderlog's schema.
 * Based on the shape captured in HAR during real trip-add operations.
 */
export function buildPlaceBlock(
  place: PlaceData,
  userId: number,
  extras: {
    hotel?: {
      checkIn: string;
      checkOut: string;
      travelerNames?: string[];
      confirmationNumber?: string | null;
    };
    startTime?: string;
    endTime?: string;
  } = {},
): Block {
  const base: Record<string, unknown> = {
    id: generateBlockId(),
    type: "place",
    place,
    text: { ops: [{ insert: "\n" }] },
    addedBy: { type: "user", userId },
    imageSize: "small",
    upvotedBy: [],
    travelMode: null,
    attachments: [],
  };
  if (extras.hotel) {
    base.hotel = {
      checkIn: extras.hotel.checkIn,
      checkOut: extras.hotel.checkOut,
      travelerNames: extras.hotel.travelerNames ?? [],
      confirmationNumber: extras.hotel.confirmationNumber ?? null,
    };
  }
  if (extras.startTime) base.startTime = extras.startTime;
  if (extras.endTime) base.endTime = extras.endTime;
  return base as unknown as Block;
}

/**
 * Finds the "Places to visit" section (the default normal+placeList section
 * at the top of every trip). Returns its index in trip.itinerary.sections.
 */
export function findPlacesToVisitSection(trip: TripPlan): {
  index: number;
  section: Section;
} | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (
      s.type === "normal" &&
      s.mode === "placeList" &&
      (s.heading === "Places to visit" || s.heading === "")
    ) {
      return { index: i, section: s };
    }
  }
  return null;
}

/**
 * Finds a custom placeList section by heading (case-insensitive fuzzy match).
 * Works for user-created lists like "Coffee places", "Beer places", etc.
 */
export function findListSectionByHeading(
  trip: TripPlan,
  heading: string,
): { index: number; section: Section } | null {
  const needle = heading.toLowerCase();
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (
      s.type === "normal" &&
      s.mode === "placeList" &&
      s.heading.toLowerCase() === needle
    ) {
      return { index: i, section: s };
    }
  }
  return null;
}

/** Finds the first hotels-type section in the trip. */
export function findHotelsSection(trip: TripPlan): {
  index: number;
  section: Section;
} | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (s.type === "hotels") return { index: i, section: s };
  }
  return null;
}

/**
 * Finds a day section by ISO date. Returns null if no matching section exists
 * (e.g. the date is outside the trip range).
 */
export function findDaySectionByDate(
  trip: TripPlan,
  isoDate: string,
): { index: number; section: Section } | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (s.mode === "dayPlan" && s.date === isoDate) {
      return { index: i, section: s };
    }
  }
  return null;
}

/**
 * Returns a search-biasing location for the trip. Tries in order:
 *   1. The first place block with geometry (most specific)
 *   2. The trip's first associated geo (from /api/tripPlans/{key} resources)
 *   3. Null if both are absent
 */
export function findTripCenter(
  trip: TripPlan,
  geos?: Geo[],
): { lat: number; lng: number } | null {
  for (const section of trip.itinerary.sections) {
    for (const block of section.blocks) {
      if (!isPlaceBlock(block)) continue;
      const loc = block.place.geometry?.location;
      if (loc) return loc;
    }
  }
  const first = geos?.[0];
  if (first) return { lat: first.latitude, lng: first.longitude };
  return null;
}

/**
 * Resolves the target section for adding a block — either a specific day
 * or the "Places to visit" list. Shared by add-place, add-note, add-checklist.
 */
export function findTargetSection(
  trip: TripPlan,
  day?: string,
): { index: number; section: Section; label: string } {
  if (day) {
    const daySection = resolveDay(trip, day);
    const found = findDaySectionByDate(trip, daySection.date!);
    if (!found) {
      throw new WanderlogValidationError(`Day ${day} not found in trip`);
    }
    return { index: found.index, section: found.section, label: `day ${daySection.date}` };
  }
  const places = findPlacesToVisitSection(trip);
  if (!places) {
    throw new WanderlogError(
      "Trip has no 'Places to visit' list",
      "no_places_section",
      "This is unexpected — Wanderlog usually creates one automatically. Try adding to a specific day instead.",
    );
  }
  return { index: places.index, section: places.section, label: "places to visit" };
}

/** Build a note block matching the shape captured from the Wanderlog UI. */
export function buildNoteBlock(userId: number): Record<string, unknown> {
  return {
    id: generateBlockId(),
    type: "note",
    text: { ops: [{ insert: "\n" }] },
    addedBy: { type: "user", userId },
    attachments: [],
  };
}

/** Build a checklist block with pre-populated items. */
export function buildChecklistBlock(
  items: string[],
  title: string,
  userId: number,
): Record<string, unknown> {
  const checklistItems: ChecklistItem[] = items.map((text) => ({
    id: generateBlockId(),
    checked: false,
    text: { ops: [{ insert: `${text}\n` }] },
  }));
  return {
    id: generateBlockId(),
    type: "checklist",
    items: checklistItems,
    title,
    addedBy: { type: "user", userId },
    attachments: [],
  };
}

/** Finds the first flights-type section in the trip. */
export function findFlightsSection(trip: TripPlan): {
  index: number;
  section: Section;
} | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (s.type === "flights") return { index: i, section: s };
  }
  return null;
}

/** Finds the first transit-type section in the trip. */
export function findTransitSection(trip: TripPlan): {
  index: number;
  section: Section;
} | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (s.type === "transit") return { index: i, section: s };
  }
  return null;
}

/** Build a FlightBlock matching Wanderlog's schema. */
export function buildFlightBlock(args: {
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
}): Block {
  const block: Record<string, unknown> = {
    id: generateBlockId(),
    type: "flight",
  };
  if (args.airline || args.flight_number) {
    block.flightInfo = {
      ...(args.airline ? { airline: { name: args.airline } } : {}),
      ...(args.flight_number ? { number: args.flight_number } : {}),
    };
  }
  if (args.depart_airport || args.depart_date || args.depart_time) {
    block.depart = {
      ...(args.depart_date ? { date: args.depart_date } : {}),
      ...(args.depart_time ? { time: args.depart_time } : {}),
      ...(args.depart_airport ? { airport: { name: args.depart_airport } } : {}),
    };
  }
  if (args.arrive_airport || args.arrive_date || args.arrive_time) {
    block.arrive = {
      ...(args.arrive_date ? { date: args.arrive_date } : {}),
      ...(args.arrive_time ? { time: args.arrive_time } : {}),
      ...(args.arrive_airport ? { airport: { name: args.arrive_airport } } : {}),
    };
  }
  if (args.confirmation_number) block.confirmationNumber = args.confirmation_number;
  if (args.traveler_names?.length) block.travelerNames = args.traveler_names;
  return block as unknown as Block;
}

/** Build a TrainBlock matching Wanderlog's schema. */
export function buildTrainBlock(args: {
  carrier?: string;
  depart_station?: string;
  depart_date?: string;
  depart_time?: string;
  arrive_station?: string;
  arrive_date?: string;
  arrive_time?: string;
  confirmation_number?: string;
  traveler_names?: string[];
}): Block {
  const block: Record<string, unknown> = {
    id: generateBlockId(),
    type: "train",
  };
  if (args.carrier) block.carrier = args.carrier;
  if (args.depart_station || args.depart_date || args.depart_time) {
    block.depart = {
      ...(args.depart_date ? { date: args.depart_date } : {}),
      ...(args.depart_time ? { time: args.depart_time } : {}),
      ...(args.depart_station ? { place: { name: args.depart_station } } : {}),
    };
  }
  if (args.arrive_station || args.arrive_date || args.arrive_time) {
    block.arrive = {
      ...(args.arrive_date ? { date: args.arrive_date } : {}),
      ...(args.arrive_time ? { time: args.arrive_time } : {}),
      ...(args.arrive_station ? { place: { name: args.arrive_station } } : {}),
    };
  }
  if (args.confirmation_number) block.confirmationNumber = args.confirmation_number;
  if (args.traveler_names?.length) block.travelerNames = args.traveler_names;
  return block as unknown as Block;
}
