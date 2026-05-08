import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import { addTrain } from "../../src/tools/add-train.ts";
import type { TripPlan } from "../../src/types.ts";

function makeTrainBlock(id: number, carrier?: string) {
  const block: Record<string, unknown> = {
    id,
    type: "train",
  };
  if (carrier) {
    block.carrier = carrier;
  }
  return block;
}

function makeTransitSection(id: number, blocks: unknown[] = []) {
  return {
    id,
    type: "transit",
    mode: "placeList" as const,
    heading: "Transit",
    date: null,
    blocks,
  };
}

function makeSection(
  id: number,
  type: "transit" | "normal",
  mode: "dayPlan" | "placeList",
  date: string | null,
  heading: string,
  blocks: unknown[],
) {
  return { id, type, mode, heading, date, blocks };
}

const transitSection = makeTransitSection(201);

const baseTrip: TripPlan = {
  id: 1,
  key: "testkey",
  title: "Japan Trip",
  userId: 42,
  privacy: "private",
  startDate: "2026-05-01",
  endDate: "2026-05-02",
  days: 2,
  placeCount: 0,
  schemaVersion: 2,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  itinerary: {
    sections: [transitSection],
  },
};

function makeContext(trip: TripPlan): {
  ctx: AppContext;
  submittedOps: Json0Op[][];
} {
  const submittedOps: Json0Op[][] = [];

  const fakeClient = {
    isSubscribed: true,
    version: 1,
    async submit(ops: Json0Op[]): Promise<void> {
      submittedOps.push(ops);
      this.version += 1;
    },
  };

  const ctx = {
    pool: {
      get: (_key: string) => fakeClient,
    },
    tripCache: {
      getEntry: async (_key: string) => ({
        snapshot: structuredClone(trip),
        geos: [],
      }),
      applyLocalOp: () => {},
      invalidate: () => {},
    },
    authenticated: true,
    userId: 42,
  } as unknown as AppContext;

  return { ctx, submittedOps };
}

describe("addTrain", () => {
  it("full details: carrier, stations, dates, times → submits li op with correct structure", async () => {
    const { ctx, submittedOps } = makeContext(baseTrip);
    const result = await addTrain(ctx, {
      trip_key: "testkey",
      carrier: "JR East",
      depart_station: "Tokyo Station",
      depart_date: "2026-05-01",
      depart_time: "07:00",
      arrive_station: "Kyoto Station",
      arrive_date: "2026-05-01",
      arrive_time: "09:30",
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(1);
    const ops = submittedOps[0]!;
    expect(ops).toHaveLength(1);
    const op = ops[0]!;

    // Verify it's an li op
    expect("li" in op).toBe(true);
    if ("li" in op) {
      expect(op.p).toEqual(["itinerary", "sections", 0, "blocks", 0]);
      const block = op.li as Record<string, unknown>;
      expect(block.type).toBe("train");
      expect(block.carrier).toBe("JR East");
      expect(block.depart).toEqual({
        date: "2026-05-01",
        time: "07:00",
        place: { name: "Tokyo Station" },
      });
      expect(block.arrive).toEqual({
        date: "2026-05-01",
        time: "09:30",
        place: { name: "Kyoto Station" },
      });
    }

    expect(result.content[0]!.text).toContain("JR East");
    expect(result.content[0]!.text).toContain("Tokyo Station");
    expect(result.content[0]!.text).toContain("Kyoto Station");
    expect(result.content[0]!.text).toContain("Japan Trip");
  });

  it("minimal: only trip_key → submits li op with type: train, no error", async () => {
    const { ctx, submittedOps } = makeContext(baseTrip);
    const result = await addTrain(ctx, {
      trip_key: "testkey",
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(1);
    const ops = submittedOps[0]!;
    expect(ops).toHaveLength(1);
    const op = ops[0]!;

    expect("li" in op).toBe(true);
    if ("li" in op) {
      expect(op.p).toEqual(["itinerary", "sections", 0, "blocks", 0]);
      const block = op.li as Record<string, unknown>;
      expect(block.type).toBe("train");
    }

    expect(result.content[0]!.text).toContain("Added train");
    expect(result.content[0]!.text).toContain("Japan Trip");
  });

  it("no transit section: findTransitSection returns null → isError:true with helpful message", async () => {
    const tripWithoutTransit: TripPlan = {
      ...baseTrip,
      itinerary: {
        sections: [
          makeSection(101, "normal", "dayPlan", "2026-05-01", "", []),
        ],
      },
    };

    const { ctx, submittedOps } = makeContext(tripWithoutTransit);
    const result = await addTrain(ctx, {
      trip_key: "testkey",
    });

    expect(result.isError).toBe(true);
    expect(submittedOps).toHaveLength(0);
    expect(result.content[0]!.text).toContain("transit section");
  });

  it("date resolution: May 15 date string → resolves to ISO date string before storing", async () => {
    const tripWithDay = {
      ...baseTrip,
      startDate: "2026-05-15",
      endDate: "2026-05-16",
      days: 2,
      itinerary: {
        sections: [
          makeTransitSection(201),
          makeSection(101, "normal", "dayPlan", "2026-05-15", "", []),
          makeSection(102, "normal", "dayPlan", "2026-05-16", "", []),
        ],
      },
    };

    const { ctx, submittedOps } = makeContext(tripWithDay);
    const result = await addTrain(ctx, {
      trip_key: "testkey",
      carrier: "Eurostar",
      depart_date: "day 1",
      arrive_date: "May 15",
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(1);
    const ops = submittedOps[0]!;
    const op = ops[0]!;

    if ("li" in op) {
      const block = op.li as Record<string, unknown>;
      const depart = block.depart as Record<string, unknown> | undefined;
      const arrive = block.arrive as Record<string, unknown> | undefined;
      // Both should resolve to ISO date strings
      expect(depart?.date).toBe("2026-05-15");
      expect(arrive?.date).toBe("2026-05-15");
    }
  });
});
