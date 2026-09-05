import { describe, expect, it } from "vitest";
import {
  STATUSES,
  holdingAcross,
  isEditable,
  toggleAcross,
  withValue,
  withoutValue,
} from "../src/core/editable";

describe("isEditable", () => {
  it("refuses every key the Web Clipper owns", () => {
    for (const key of ["title", "source", "author", "published", "created", "description", "tags"]) {
      expect(isEditable(key)).toBe(false);
    }
  });

  it("refuses the keys the plugin owns itself", () => {
    for (const key of ["type", "grid", "folder", "cover", "media"]) {
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

describe("holdingAcross", () => {
  it("is all when every clipping holds the value", () => {
    expect(holdingAcross([["design"], ["design", "ios"]], "design")).toBe("all");
  });

  it("is some when only part of the selection holds it", () => {
    expect(holdingAcross([["design"], ["ios"]], "design")).toBe("some");
  });

  it("is none when nothing holds it", () => {
    expect(holdingAcross([["ios"], []], "design")).toBe("none");
  });

  it("is none for an empty selection", () => {
    expect(holdingAcross([], "design")).toBe("none");
  });
});

describe("toggleAcross", () => {
  it("removes a value every clipping holds, from each of them", () => {
    expect(toggleAcross([["design"], ["design", "ios"]], "design", false)).toEqual([[], ["ios"]]);
  });

  it("adds a value only some hold, to the ones missing it, without duplicating", () => {
    expect(toggleAcross([["design"], ["ios"]], "design", false)).toEqual([["design"], ["ios", "design"]]);
  });

  it("replaces on a single-choice property, and clears when all already hold it", () => {
    expect(toggleAcross([["unread"], ["read"]], "read", true)).toEqual([["read"], ["read"]]);
    expect(toggleAcross([["read"], ["read"]], "read", true)).toEqual([[], []]);
  });

  it("returns new lists", () => {
    const held = [["design"]];
    const next = toggleAcross(held, "ios", false);
    expect(held).toEqual([["design"]]);
    expect(next[0]).not.toBe(held[0]);
  });
});
