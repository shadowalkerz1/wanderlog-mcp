import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import { movePlace } from "../../src/tools/move-place.ts";
import type { TripPlan } from "../../src/types.ts";

function makePlaceBlock(id: number, name: string) {
  return {
    id,
    type: "place" as const,
    place: { name, place_id: `ChIJ${id}` },
  };
}

function makeSection(
  id: number,
  mode: "dayPlan" | "placeList",
  date: string | null,
  heading: string,
  blocks: ReturnType<typeof makePlaceBlock>[],
) {
  return { id, type: "normal" as const, mode, heading, date, blocks };
}

const day1 = makeSection(101, "dayPlan", "2026-05-01", "", [
  makePlaceBlock(1001, "Sensō-ji"),
  makePlaceBlock(1002, "Tokyo Tower"),
  makePlaceBlock(1003, "Shibuya Crossing"),
]);

const day2 = makeSection(102, "dayPlan", "2026-05-02", "", [
  makePlaceBlock(2001, "Ueno Park"),
  makePlaceBlock(2002, "Akihabara"),
]);

const templesList = makeSection(103, "placeList", null, "Temples", [
  makePlaceBlock(3001, "Meiji Shrine"),
]);

const baseTrip: TripPlan = {
  id: 1,
  key: "testkey",
  title: "Tokyo Trip",
  userId: 42,
  privacy: "private",
  startDate: "2026-05-01",
  endDate: "2026-05-02",
  days: 2,
  placeCount: 6,
  schemaVersion: 2,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  itinerary: {
    sections: [day1, day2, templesList],
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
      get: async (_key: string): Promise<TripPlan> => structuredClone(trip),
      applyLocalOp: () => {},
      invalidate: () => {},
    },
    authenticated: true,
  } as unknown as AppContext;

  return { ctx, submittedOps };
}

describe("movePlace", () => {
  it("same-section reorder: move first block to last → emits single lm op", async () => {
    const { ctx, submittedOps } = makeContext(baseTrip);
    const result = await movePlace(ctx, {
      trip_key: "testkey",
      place_ref: "Sensō-ji",
      to: "day 1",
      position: "last",
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(1);
    const ops = submittedOps[0]!;
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect("lm" in op).toBe(true);
    if ("lm" in op) {
      expect(op.p).toEqual(["itinerary", "sections", 0, "blocks", 0]);
      expect(op.lm).toBe(2);
    }
    expect(result.content[0]!.text).toContain("Sensō-ji");
    expect(result.content[0]!.text).toContain("Tokyo Trip");
  });

  it("cross-section move: move from day 1 to day 2 → emits ld+li ops", async () => {
    const { ctx, submittedOps } = makeContext(baseTrip);
    const result = await movePlace(ctx, {
      trip_key: "testkey",
      place_ref: "Sensō-ji",
      to: "day 2",
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(1);
    const ops = submittedOps[0]!;
    expect(ops).toHaveLength(2);

    const ldOp = ops.find((o) => "ld" in o);
    const liOp = ops.find((o) => "li" in o);
    expect(ldOp).toBeDefined();
    expect(liOp).toBeDefined();

    if (ldOp && "ld" in ldOp) {
      expect(ldOp.p).toEqual(["itinerary", "sections", 0, "blocks", 0]);
    }
    if (liOp && "li" in liOp) {
      expect((liOp.p as (string | number)[])[2]).toBe(1);
    }
    expect(result.content[0]!.text).toContain("Moved");
    expect(result.content[0]!.text).toContain("Sensō-ji");
  });

  it("copy: copy=true → emits only li op, source untouched", async () => {
    const { ctx, submittedOps } = makeContext(baseTrip);
    const result = await movePlace(ctx, {
      trip_key: "testkey",
      place_ref: "Sensō-ji",
      to: "day 2",
      copy: true,
    });

    expect(result.isError).toBeFalsy();
    expect(submittedOps).toHaveLength(1);
    const ops = submittedOps[0]!;
    expect(ops).toHaveLength(1);

    const liOp = ops[0]!;
    expect("li" in liOp).toBe(true);
    expect("ld" in liOp).toBe(false);

    if ("li" in liOp) {
      const insertedBlock = liOp.li as { place: { name: string } };
      expect(insertedBlock.place.name).toBe("Sensō-ji");
    }
    expect(result.content[0]!.text).toContain("Copied");
    expect(result.content[0]!.text).toContain("Sensō-ji");
  });

  it("'first' position: destination position 'first' → inserts at index 0", async () => {
    const { ctx, submittedOps } = makeContext(baseTrip);
    const result = await movePlace(ctx, {
      trip_key: "testkey",
      place_ref: "Sensō-ji",
      to: "day 2",
      position: "first",
    });

    expect(result.isError).toBeFalsy();
    const ops = submittedOps[0]!;
    const liOp = ops.find((o) => "li" in o);
    expect(liOp).toBeDefined();
    if (liOp && "li" in liOp) {
      const p = liOp.p as (string | number)[];
      expect(p[p.length - 1]).toBe(0);
    }
  });

  it("destination not found: to='Nonexistent' → returns isError:true", async () => {
    const { ctx } = makeContext(baseTrip);
    const result = await movePlace(ctx, {
      trip_key: "testkey",
      place_ref: "Sensō-ji",
      to: "Nonexistent",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Nonexistent");
  });

  it("place_ref not found: place_ref='nonexistent place' → returns isError:true", async () => {
    const { ctx } = makeContext(baseTrip);
    const result = await movePlace(ctx, {
      trip_key: "testkey",
      place_ref: "nonexistent place xyz",
      to: "day 1",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not found");
  });
});
