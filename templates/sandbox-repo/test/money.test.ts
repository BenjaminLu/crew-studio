import { describe, expect, test } from "bun:test";
import { add, split } from "../src/money";

describe("add", () => {
  test("adds amounts", () => expect(add(250, 250, 100)).toBe(600));
  test("adds nothing to zero", () => expect(add()).toBe(0));
});

describe("split", () => {
  test("splits evenly when it can", () => expect(split(900, 3)).toEqual([300, 300, 300]));
  test("gives the extra cents to the first parts", () => expect(split(1000, 3)).toEqual([334, 333, 333]));
  test("refuses zero parts", () => expect(() => split(100, 0)).toThrow());
});
