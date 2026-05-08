import { describe, expect, it } from "vitest";
import {
  resolveInsertPosition,
  resolveLmPosition,
} from "../../src/resolvers/position.ts";
import { WanderlogNotFoundError } from "../../src/errors.ts";
import type { Block } from "../../src/types.ts";

function makeBlock(name: string): Block {
  return {
    id: Number(name === "Museum" ? 1 : name === "Park" ? 2 : 3),
    type: "place",
    place: {
      name,
      place_id: "x",
    },
  } as Block;
}

const blocks = [makeBlock("Museum"), makeBlock("Park"), makeBlock("Temple")];

describe("resolveInsertPosition", () => {
  describe("undefined and 'last'", () => {
    it("returns blocks.length for undefined", () => {
      expect(resolveInsertPosition(blocks, undefined)).toBe(3);
    });

    it("returns blocks.length for 'last'", () => {
      expect(resolveInsertPosition(blocks, "last")).toBe(3);
    });

    it("returns 0 for undefined with empty blocks", () => {
      expect(resolveInsertPosition([], undefined)).toBe(0);
    });
  });

  describe("'first'", () => {
    it("returns 0", () => {
      expect(resolveInsertPosition(blocks, "first")).toBe(0);
    });

    it("returns 0 with empty blocks", () => {
      expect(resolveInsertPosition([], "first")).toBe(0);
    });
  });

  describe("numeric strings", () => {
    it("converts 1-based '1' to index 0", () => {
      expect(resolveInsertPosition(blocks, "1")).toBe(0);
    });

    it("converts 1-based '2' to index 1", () => {
      expect(resolveInsertPosition(blocks, "2")).toBe(1);
    });

    it("converts 1-based '3' to index 2", () => {
      expect(resolveInsertPosition(blocks, "3")).toBe(2);
    });

    it("clamps '5' (beyond length) to blocks.length", () => {
      expect(resolveInsertPosition(blocks, "5")).toBe(3);
    });

    it("clamps '0' to 0", () => {
      expect(resolveInsertPosition(blocks, "0")).toBe(0);
    });

    it("clamps large numbers to blocks.length", () => {
      expect(resolveInsertPosition(blocks, "100")).toBe(3);
    });
  });

  describe("'before X'", () => {
    it("returns index of block whose name contains substring (case-insensitive)", () => {
      expect(resolveInsertPosition(blocks, "before park")).toBe(1);
    });

    it("matches case-insensitively", () => {
      expect(resolveInsertPosition(blocks, "before MUSEUM")).toBe(0);
    });

    it("matches substring", () => {
      expect(resolveInsertPosition(blocks, "before eum")).toBe(0);
    });

    it("throws WanderlogNotFoundError when no match", () => {
      expect(() => {
        resolveInsertPosition(blocks, "before NonExistent");
      }).toThrow(WanderlogNotFoundError);
    });

    it("returns 0 when matching first block", () => {
      expect(resolveInsertPosition(blocks, "before Museum")).toBe(0);
    });
  });

  describe("'after X'", () => {
    it("returns index + 1 of matched block", () => {
      expect(resolveInsertPosition(blocks, "after museum")).toBe(1);
    });

    it("returns index + 1 for matched block (park)", () => {
      expect(resolveInsertPosition(blocks, "after park")).toBe(2);
    });

    it("returns blocks.length when matching last block", () => {
      expect(resolveInsertPosition(blocks, "after temple")).toBe(3);
    });

    it("throws WanderlogNotFoundError when no match", () => {
      expect(() => {
        resolveInsertPosition(blocks, "after NonExistent");
      }).toThrow(WanderlogNotFoundError);
    });

    it("matches case-insensitively", () => {
      expect(resolveInsertPosition(blocks, "after TEMPLE")).toBe(3);
    });
  });
});

describe("resolveLmPosition", () => {
  describe("undefined and 'last'", () => {
    it("returns blocks.length - 1 for undefined", () => {
      expect(resolveLmPosition(blocks, undefined, 0)).toBe(2);
    });

    it("returns blocks.length - 1 for 'last'", () => {
      expect(resolveLmPosition(blocks, "last", 0)).toBe(2);
    });
  });

  describe("'first'", () => {
    it("returns 0", () => {
      expect(resolveLmPosition(blocks, "first", 1)).toBe(0);
    });
  });

  describe("numeric strings", () => {
    it("converts 1-based '1' to index 0", () => {
      expect(resolveLmPosition(blocks, "1", 1)).toBe(0);
    });

    it("converts 1-based '2' to index 1", () => {
      expect(resolveLmPosition(blocks, "2", 0)).toBe(1);
    });

    it("clamps to blocks.length - 1", () => {
      expect(resolveLmPosition(blocks, "5", 0)).toBe(2);
    });

    it("clamps '0' to 0", () => {
      expect(resolveLmPosition(blocks, "0", 1)).toBe(0);
    });
  });

  describe("'before X' with fromIndex adjustments", () => {
    it("returns adjusted index when fromIndex < i (X shifts left)", () => {
      // Museum at 0, Park at 1, Temple at 2
      // moving from Museum (0) to before Temple (2)
      // After removing index 0, Temple shifts left to 1, so insert before it at 1
      expect(resolveLmPosition(blocks, "before temple", 0)).toBe(1);
    });

    it("returns index when fromIndex > i (X stays at same position)", () => {
      // moving from Temple (2) to before Park (1)
      // After removing index 2, Park is still at 1, so insert before it at 1
      expect(resolveLmPosition(blocks, "before park", 2)).toBe(1);
    });

    it("handles before first block", () => {
      // moving from Park (1) to before Museum (0)
      // After removing index 1, Museum is still at 0, so insert before it at 0
      expect(resolveLmPosition(blocks, "before museum", 1)).toBe(0);
    });

    it("throws WanderlogNotFoundError when no match", () => {
      expect(() => {
        resolveLmPosition(blocks, "before NonExistent", 0);
      }).toThrow(WanderlogNotFoundError);
    });
  });

  describe("'after X' with fromIndex adjustments", () => {
    it("returns i when fromIndex > i (X stays at same position)", () => {
      // moving from Temple (2) to after Museum (0)
      // After removing index 2, Museum is still at 0, so insert after it at min(0+1, 2) = 1
      expect(resolveLmPosition(blocks, "after museum", 2)).toBe(1);
    });

    it("returns i (adjusted) when fromIndex < i (X shifts left)", () => {
      // moving from Museum (0) to after Park (1)
      // After removing index 0, Park shifts left to 0, so insert after it at min(0+1, 2) = 1
      expect(resolveLmPosition(blocks, "after park", 0)).toBe(1);
    });

    it("handles after last block clamped to blocks.length - 1", () => {
      // moving from Park (1) to after Temple (2)
      // After removing index 1, Temple is still at 2, so insert after it at min(2+1, 2) = 2
      expect(resolveLmPosition(blocks, "after temple", 1)).toBe(2);
    });

    it("throws WanderlogNotFoundError when no match", () => {
      expect(() => {
        resolveLmPosition(blocks, "after NonExistent", 0);
      }).toThrow(WanderlogNotFoundError);
    });
  });

  describe("empty blocks", () => {
    it("throws WanderlogNotFoundError when blocks.length === 0", () => {
      expect(() => {
        resolveLmPosition([], "first", 0);
      }).toThrow(WanderlogNotFoundError);
    });
  });
});
