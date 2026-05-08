/**
 * Unit tests for addHotel — covers the 4 new optional parameters:
 *   confirmation_number, traveler_names, check_in_time, check_out_time
 *
 * Strategy: use a fake AppContext that captures all submitted op arrays
 * (each submitOp call = one entry in submittedOps). Inspect what was submitted
 * rather than calling the live Wanderlog API.
 */

import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import { addHotel } from "../../src/tools/add-hotel.ts";
import type { PlaceBlock, TripPlan } from "../../src/types.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";

// ---------------------------------------------------------------------------
// Fake context factory
// ---------------------------------------------------------------------------

type FakeContextOptions = {
  trip?: TripPlan;
  /** Place name returned by the fake REST search. */
  placeName?: string;
};

function makeFakeContext(options: FakeContextOptions = {}): {
  ctx: AppContext;
  submittedOps: Json0Op[][];
} {
  const trip = structuredClone(options.trip ?? queenstownTrip);
  const placeName = options.placeName ?? "Park Hyatt Tokyo";
  const submittedOps: Json0Op[][] = [];
  let version = 0;

  const fakeDetail = {
    name: placeName,
    place_id: "ChIJtest",
    geometry: { location: { lat: 35.6762, lng: 139.6503 } },
  };

  const ctx = {
    userId: 3656632,
    pool: {
      get: (_key: string) => ({
        isSubscribed: true,
        version,
        async submit(ops: Json0Op[]): Promise<void> {
          submittedOps.push(ops);
          version += 1;
        },
      }),
    },
    tripCache: {
      getEntry: async (_key: string) => ({
        snapshot: trip,
        geos: [
          {
            id: 1,
            name: "Tokyo",
            latitude: 35.6762,
            longitude: 139.6503,
          },
        ],
      }),
      applyLocalOp: () => {},
      invalidate: () => {},
    },
    rest: {
      searchPlacesAutocomplete: async () => [{ place_id: "ChIJtest" }],
      getPlaceDetails: async (_id: string) => fakeDetail,
    },
  } as unknown as AppContext;

  return { ctx, submittedOps };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the inserted PlaceBlock out of the first submitted li op. */
function extractInsertedBlock(ops: Json0Op[]): PlaceBlock {
  const liOp = ops.find((o) => "li" in o);
  if (!liOp) throw new Error("No li op found");
  return liOp.li as PlaceBlock;
}

// ---------------------------------------------------------------------------
// Baseline (existing behaviour, not breaking)
// ---------------------------------------------------------------------------

describe("addHotel – baseline", () => {
  it("inserts the hotel block into the existing hotels section", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    const result = await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(1);
    const block = extractInsertedBlock(submittedOps[0]!);
    expect(block.hotel?.checkIn).toBe("2026-05-15");
    expect(block.hotel?.checkOut).toBe("2026-05-18");
    expect(block.hotel?.confirmationNumber).toBeNull();
    expect(block.hotel?.travelerNames).toEqual([]);
  });

  it("returns a confirmation message with hotel name and dates", async () => {
    const { ctx } = makeFakeContext();
    const result = await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
    });

    expect(result.content[0]!.text).toContain("Park Hyatt Tokyo");
    expect(result.content[0]!.text).toContain("2026-05-15");
    expect(result.content[0]!.text).toContain("2026-05-18");
  });
});

// ---------------------------------------------------------------------------
// confirmation_number
// ---------------------------------------------------------------------------

describe("addHotel – confirmation_number", () => {
  it("stores the confirmation number in the hotel booking sub-object", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      confirmation_number: "ABC123",
    });

    const block = extractInsertedBlock(submittedOps[0]!);
    expect(block.hotel?.confirmationNumber).toBe("ABC123");
  });

  it("includes confirmation number in the success response text", async () => {
    const { ctx } = makeFakeContext();
    const result = await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      confirmation_number: "ABC123",
    });

    expect(result.content[0]!.text).toContain("ABC123");
  });

  it("omits confirmation from response text when not provided", async () => {
    const { ctx } = makeFakeContext();
    const result = await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
    });

    expect(result.content[0]!.text).not.toContain("Confirmation:");
  });
});

// ---------------------------------------------------------------------------
// traveler_names
// ---------------------------------------------------------------------------

describe("addHotel – traveler_names", () => {
  it("stores traveler names in the hotel booking sub-object", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      traveler_names: ["Alice", "Bob"],
    });

    const block = extractInsertedBlock(submittedOps[0]!);
    expect(block.hotel?.travelerNames).toEqual(["Alice", "Bob"]);
  });

  it("defaults traveler_names to an empty array when omitted", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
    });

    const block = extractInsertedBlock(submittedOps[0]!);
    expect(block.hotel?.travelerNames).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// check_in_time / check_out_time
// ---------------------------------------------------------------------------

describe("addHotel – check_in_time and check_out_time", () => {
  it("emits a second submitOp call with oi ops for both times", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      check_in_time: "15:00",
      check_out_time: "11:00",
    });

    // First call inserts the block; second call sets timing
    expect(submittedOps).toHaveLength(2);

    const timeOps = submittedOps[1]!;
    const startTimeOp = timeOps.find(
      (o) => Array.isArray(o.p) && o.p[o.p.length - 1] === "startTime",
    );
    const endTimeOp = timeOps.find(
      (o) => Array.isArray(o.p) && o.p[o.p.length - 1] === "endTime",
    );

    expect(startTimeOp).toBeDefined();
    expect(startTimeOp!.oi).toBe("15:00");

    expect(endTimeOp).toBeDefined();
    expect(endTimeOp!.oi).toBe("11:00");
  });

  it("only emits check_in_time op when check_out_time is omitted", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      check_in_time: "15:00",
    });

    expect(submittedOps).toHaveLength(2);
    const timeOps = submittedOps[1]!;
    expect(timeOps.some((o) => o.p[o.p.length - 1] === "startTime")).toBe(true);
    expect(timeOps.some((o) => o.p[o.p.length - 1] === "endTime")).toBe(false);
  });

  it("only emits check_out_time op when check_in_time is omitted", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      check_out_time: "11:00",
    });

    expect(submittedOps).toHaveLength(2);
    const timeOps = submittedOps[1]!;
    expect(timeOps.some((o) => o.p[o.p.length - 1] === "endTime")).toBe(true);
    expect(timeOps.some((o) => o.p[o.p.length - 1] === "startTime")).toBe(false);
  });

  it("does not emit a second submitOp when neither time is provided", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
    });

    expect(submittedOps).toHaveLength(1);
  });

  it("time ops target the correct block path (existing hotels section)", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    // queenstownTrip already has a hotels section at index 1 with 1 block,
    // so the new block lands at blocks[1], i.e. path [..., 1, "blocks", 1, "startTime"].
    await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      check_in_time: "15:00",
    });

    const timeOps = submittedOps[1]!;
    const startTimeOp = timeOps.find(
      (o) => Array.isArray(o.p) && o.p[o.p.length - 1] === "startTime",
    )!;

    // Path should be: ["itinerary", "sections", <sectionIdx>, "blocks", <blockIdx>, "startTime"]
    expect(startTimeOp.p[0]).toBe("itinerary");
    expect(startTimeOp.p[1]).toBe("sections");
    expect(startTimeOp.p[3]).toBe("blocks");
    expect(startTimeOp.p[5]).toBe("startTime");
  });

  it("includes check-in and check-out times in the success response text", async () => {
    const { ctx } = makeFakeContext();
    const result = await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      check_in_time: "15:00",
      check_out_time: "11:00",
    });

    expect(result.content[0]!.text).toContain("15:00");
    expect(result.content[0]!.text).toContain("11:00");
  });
});

// ---------------------------------------------------------------------------
// All params combined
// ---------------------------------------------------------------------------

describe("addHotel – all new params combined", () => {
  it("stores all fields and emits the full response", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    const result = await addHotel(ctx, {
      trip_key: "test",
      hotel: "Park Hyatt Tokyo",
      check_in: "2026-05-15",
      check_out: "2026-05-18",
      confirmation_number: "ABC123",
      traveler_names: ["Alice", "Bob"],
      check_in_time: "15:00",
      check_out_time: "11:00",
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(2);

    const block = extractInsertedBlock(submittedOps[0]!);
    expect(block.hotel?.confirmationNumber).toBe("ABC123");
    expect(block.hotel?.travelerNames).toEqual(["Alice", "Bob"]);

    const text = result.content[0]!.text;
    expect(text).toContain("Park Hyatt Tokyo");
    expect(text).toContain("2026-05-15");
    expect(text).toContain("2026-05-18");
    expect(text).toContain("15:00");
    expect(text).toContain("11:00");
    expect(text).toContain("ABC123");
  });
});
