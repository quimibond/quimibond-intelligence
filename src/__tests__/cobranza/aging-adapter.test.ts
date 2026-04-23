import { describe, expect, it } from "vitest";
import { adaptAging } from "@/app/cobranza/_components/aging-adapter";

describe("adaptAging", () => {
  it("renames hyphen keys to d_ underscore keys, keeps current", () => {
    expect(
      adaptAging({
        current: 100,
        "1-30": 200,
        "31-60": 300,
        "61-90": 400,
        "90+": 500,
      })
    ).toEqual({
      current: 100,
      d1_30: 200,
      d31_60: 300,
      d61_90: 400,
      d90_plus: 500,
    });
  });

  it("defaults missing keys to 0", () => {
    expect(adaptAging({})).toEqual({
      current: 0,
      d1_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
    });
  });

  it("coerces non-numeric values to 0", () => {
    expect(
      adaptAging({ current: NaN as unknown as number, "1-30": null as unknown as number })
    ).toEqual({
      current: 0,
      d1_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
    });
  });
});
