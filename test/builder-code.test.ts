import { afterEach, describe, expect, test } from "bun:test";
import { withBuilderCode } from "../api/_x402-gate";

const bazaar = { bazaar: { info: { input: { method: "POST" } } } };

describe("withBuilderCode", () => {
  afterEach(() => { delete process.env.BUILDER_CODE; });

  test("leaves the 402 extensions unchanged when no code is set", () => {
    expect(withBuilderCode(bazaar)).toEqual(bazaar);
  });

  test("adds the builder-code declaration next to bazaar", () => {
    process.env.BUILDER_CODE = "bc_a1b2c3d4";
    const ext = withBuilderCode(bazaar) as any;
    expect(ext.bazaar).toEqual(bazaar.bazaar);
    expect(ext["builder-code"].info.a).toBe("bc_a1b2c3d4");
  });

  test("ignores an invalid code instead of breaking the 402", () => {
    process.env.BUILDER_CODE = "Not A Code!";
    expect(withBuilderCode(bazaar)).toEqual(bazaar);
  });
});
