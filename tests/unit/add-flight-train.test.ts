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
    if (block.type !== "flight") throw new Error("expected flight block");
    expect(block.type).toBe("flight");
    expect(block.flightInfo?.airline?.name).toBe("Singapore Airlines");
    expect(block.flightInfo?.number).toBe("SQ 321");
    expect(block.depart?.airport?.iata).toBe("SIN");
    expect(block.depart?.airport?.name).toBeUndefined();
    expect(block.depart?.time).toBe("09:00");
    expect(block.arrive?.airport?.iata).toBe("NRT");
    expect(block.arrive?.airport?.name).toBeUndefined();
    expect(block.confirmationNumber).toBe("ABC123");
    expect(block.travelerNames).toEqual(["Alice"]);
  });

  it("stores plain airport names in airport.name", () => {
    const block = buildFlightBlock({
      depart_airport: "Singapore",
      arrive_airport: "Tokyo Narita",
    });
    if (block.type !== "flight") throw new Error("expected flight block");
    expect(block.depart?.airport?.name).toBe("Singapore");
    expect(block.depart?.airport?.iata).toBeUndefined();
    expect(block.arrive?.airport?.name).toBe("Tokyo Narita");
    expect(block.arrive?.airport?.iata).toBeUndefined();
  });

  it("detects IATA codes and stores in airport.iata", () => {
    const block = buildFlightBlock({
      depart_airport: "JFK",
      arrive_airport: "LAX",
    });
    if (block.type !== "flight") throw new Error("expected flight block");
    expect(block.depart?.airport?.iata).toBe("JFK");
    expect(block.depart?.airport?.name).toBeUndefined();
    expect(block.arrive?.airport?.iata).toBe("LAX");
    expect(block.arrive?.airport?.name).toBeUndefined();
  });

  it("builds a minimal block with only type and id", () => {
    const block = buildFlightBlock({});
    if (block.type !== "flight") throw new Error("expected flight block");
    expect(block.type).toBe("flight");
    expect(typeof block.id).toBe("number");
    expect(block.flightInfo).toBeUndefined();
    expect(block.depart).toBeUndefined();
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
    if (block.type !== "train") throw new Error("expected train block");
    expect(block.type).toBe("train");
    expect(block.carrier).toBe("JR East");
    expect(block.depart?.place?.name).toBe("Tokyo Station");
    expect(block.arrive?.place?.name).toBe("Kyoto Station");
    expect(block.confirmationNumber).toBe("XYZ789");
  });

  it("builds a minimal block", () => {
    const block = buildTrainBlock({});
    if (block.type !== "train") throw new Error("expected train block");
    expect(block.type).toBe("train");
    expect(block.carrier).toBeUndefined();
  });
});
