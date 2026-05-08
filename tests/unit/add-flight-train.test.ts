import { describe, expect, it } from "vitest";
import {
  buildFlightBlock,
  buildTrainBlock,
  findFlightsSection,
  findTransitSection,
} from "../../src/tools/shared.ts";
import { mixedBlocksTrip } from "../fixtures/mixed-blocks-trip.ts";

describe("findFlightsSection", () => {
  it("finds the flights section in mixedBlocksTrip", () => {
    const result = findFlightsSection(mixedBlocksTrip);
    expect(result).not.toBeNull();
    expect(result!.section.type).toBe("flights");
    expect(result!.section.blocks).toHaveLength(1);
  });

  it("returns null when no flights section exists", () => {
    const trip = {
      ...mixedBlocksTrip,
      itinerary: { sections: mixedBlocksTrip.itinerary.sections.filter((s) => s.type !== "flights") },
    };
    expect(findFlightsSection(trip)).toBeNull();
  });
});

describe("findTransitSection", () => {
  it("finds the transit section in mixedBlocksTrip", () => {
    const result = findTransitSection(mixedBlocksTrip);
    expect(result).not.toBeNull();
    expect(result!.section.type).toBe("transit");
  });

  it("returns null when no transit section exists", () => {
    const trip = {
      ...mixedBlocksTrip,
      itinerary: { sections: mixedBlocksTrip.itinerary.sections.filter((s) => s.type !== "transit") },
    };
    expect(findTransitSection(trip)).toBeNull();
  });
});

describe("buildFlightBlock", () => {
  it("builds a block with all fields", () => {
    const block = buildFlightBlock({
      airline: "Singapore Airlines",
      flight_number: "SQ 321",
      depart_airport: "SIN",
      depart_date: "2026-05-15",
      depart_time: "09:00",
      arrive_airport: "NRT",
      arrive_date: "2026-05-15",
      arrive_time: "17:30",
      confirmation_number: "ABC123",
      traveler_names: ["Alice"],
    });
    expect(block.type).toBe("flight");
    expect((block as any).flightInfo?.airline?.name).toBe("Singapore Airlines");
    expect((block as any).flightInfo?.number).toBe("SQ 321");
    expect((block as any).depart?.airport?.name).toBe("SIN");
    expect((block as any).depart?.time).toBe("09:00");
    expect((block as any).arrive?.airport?.name).toBe("NRT");
    expect((block as any).confirmationNumber).toBe("ABC123");
    expect((block as any).travelerNames).toEqual(["Alice"]);
  });

  it("builds a minimal block with only type and id", () => {
    const block = buildFlightBlock({});
    expect(block.type).toBe("flight");
    expect(typeof (block as any).id).toBe("number");
    expect((block as any).flightInfo).toBeUndefined();
    expect((block as any).depart).toBeUndefined();
  });
});

describe("buildTrainBlock", () => {
  it("builds a block with all fields", () => {
    const block = buildTrainBlock({
      carrier: "JR East",
      depart_station: "Tokyo Station",
      depart_date: "2026-05-16",
      depart_time: "07:00",
      arrive_station: "Kyoto Station",
      arrive_date: "2026-05-16",
      arrive_time: "09:30",
      confirmation_number: "XYZ789",
      traveler_names: ["Bob"],
    });
    expect(block.type).toBe("train");
    expect((block as any).carrier).toBe("JR East");
    expect((block as any).depart?.place?.name).toBe("Tokyo Station");
    expect((block as any).arrive?.place?.name).toBe("Kyoto Station");
    expect((block as any).confirmationNumber).toBe("XYZ789");
  });

  it("builds a minimal block", () => {
    const block = buildTrainBlock({});
    expect(block.type).toBe("train");
    expect((block as any).carrier).toBeUndefined();
  });
});
