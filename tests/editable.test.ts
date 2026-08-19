import { describe, expect, it } from "vitest";
import { STATUSES, isEditable, withValue, withoutValue } from "../src/editable";

describe("isEditable", () => {
  it("refuses every key the Web Clipper owns", () => {
    for (const key of ["title", "source", "author", "published", "created", "description", "tags"]) {
      expect(isEditable(key)).toBe(false);
    }
  });

  it("refuses the keys the plugin owns itself", () => {
    for (const key of ["type", "grid", "cover", "media"]) {
      expect(isEditable(key)).toBe(false);
    }
  });

  it("allows the two properties the vault treats as the user's", () => {
    expect(isEditable("categories")).toBe(true);
    expect(isEditable("status")).toBe(true);
  });

  it("allows a property the user invented", () => {
    expect(isEditable("medium")).toBe(true);
  });

  it("is not fooled by casing or padding", () => {
    expect(isEditable("Title")).toBe(false);
    expect(isEditable("  source  ")).toBe(false);
  });
});

describe("withValue", () => {
  it("appends to the end, so existing order is left alone", () => {
    expect(withValue(["design", "ios"], "manga")).toEqual(["design", "ios", "manga"]);
  });

  it("refuses a duplicate rather than writing it twice", () => {
    expect(withValue(["design"], "design")).toEqual(["design"]);
  });

  it("trims, and ignores a value that is only whitespace", () => {
    expect(withValue(["design"], "  ios  ")).toEqual(["design", "ios"]);
    expect(withValue(["design"], "   ")).toEqual(["design"]);
  });

  it("does not edit the list it was given", () => {
    const before = ["design"];
    withValue(before, "ios");
    expect(before).toEqual(["design"]);
  });
});

describe("withoutValue", () => {
  it("removes the value", () => {
    expect(withoutValue(["design", "ios"], "design")).toEqual(["ios"]);
  });

  it("removes every occurrence, so a duplicated value cannot survive one click", () => {
    expect(withoutValue(["a", "b", "a"], "a")).toEqual(["b"]);
  });

  it("does not edit the list it was given", () => {
    const before = ["design", "ios"];
    withoutValue(before, "design");
    expect(before).toEqual(["design", "ios"]);
  });
});

describe("STATUSES", () => {
  it("is the vocabulary the vault defines, in reading order", () => {
    expect(STATUSES).toEqual(["unread", "read", "archived"]);
  });
});
