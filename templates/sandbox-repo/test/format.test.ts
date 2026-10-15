import { describe, expect, test } from "bun:test";
import { format } from "../src/money";

describe("format", () => {
  test("shows dollars and cents", () => expect(format(1999)).toBe("$19.99"));
  test("pads the cents", () => expect(format(105)).toBe("$1.05"));
  test("shows a minus sign", () => expect(format(-250)).toBe("-$2.50"));
});
