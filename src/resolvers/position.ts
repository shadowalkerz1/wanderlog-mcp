import { WanderlogNotFoundError } from "../errors.js";
import type { Block, PlaceBlock } from "../types.js";

function getBlockName(block: Block): string | undefined {
  if (block.type === "place") {
    return (block as PlaceBlock).place?.name;
  }
  return undefined;
}

function findBlockByNameSubstring(
  blocks: Block[],
  substring: string,
): number | undefined {
  const lowerSubstring = substring.toLowerCase();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    const name = getBlockName(block);
    if (name && name.toLowerCase().includes(lowerSubstring)) {
      return i;
    }
  }
  return undefined;
}

export function resolveInsertPosition(
  blocks: Block[],
  position: string | undefined,
): number {
  if (position === undefined || position === "last") {
    return blocks.length;
  }

  if (position === "first") {
    return 0;
  }

  const numMatch = /^\d+$/.test(position);
  if (numMatch) {
    const num = Number.parseInt(position, 10);
    const zeroBasedIndex = num - 1;
    return Math.max(0, Math.min(zeroBasedIndex, blocks.length));
  }

  if (position.startsWith("before ")) {
    const target = position.slice(7);
    const index = findBlockByNameSubstring(blocks, target);
    if (index === undefined) {
      throw new WanderlogNotFoundError("Block", target);
    }
    return index;
  }

  if (position.startsWith("after ")) {
    const target = position.slice(6);
    const index = findBlockByNameSubstring(blocks, target);
    if (index === undefined) {
      throw new WanderlogNotFoundError("Block", target);
    }
    return index + 1;
  }

  return blocks.length;
}

export function resolveLmPosition(
  blocks: Block[],
  position: string | undefined,
  fromIndex: number,
): number {
  if (blocks.length === 0) {
    throw new WanderlogNotFoundError("No blocks to move");
  }

  if (position === undefined || position === "last") {
    return blocks.length - 1;
  }

  if (position === "first") {
    return 0;
  }

  const numMatch = /^\d+$/.test(position);
  if (numMatch) {
    const num = Number.parseInt(position, 10);
    const zeroBasedIndex = num - 1;
    return Math.max(0, Math.min(zeroBasedIndex, blocks.length - 1));
  }

  if (position.startsWith("before ")) {
    const target = position.slice(7);
    const i = findBlockByNameSubstring(blocks, target);
    if (i === undefined) {
      throw new WanderlogNotFoundError("Block", target);
    }

    if (fromIndex < i) {
      return i - 1;
    } else {
      return i;
    }
  }

  if (position.startsWith("after ")) {
    const target = position.slice(6);
    const i = findBlockByNameSubstring(blocks, target);
    if (i === undefined) {
      throw new WanderlogNotFoundError("Block", target);
    }

    if (fromIndex < i) {
      return i;
    } else {
      return Math.min(i + 1, blocks.length - 1);
    }
  }

  return blocks.length - 1;
}
