import { describe, expect, it } from "vitest";
import { History } from "../src/core/history";

function entry(label: string, log: string[]) {
  return {
    label,
    undo: async () => {
      log.push(`undo ${label}`);
    },
    redo: async () => {
      log.push(`redo ${label}`);
    },
  };
}

describe("History", () => {
  it("names what undo and redo would do, or nothing", () => {
    const history = new History();
    expect(history.undoLabel).toBeNull();
    expect(history.redoLabel).toBeNull();
    history.push(entry("Move to Kitchen", []));
    expect(history.undoLabel).toBe("Move to Kitchen");
    expect(history.redoLabel).toBeNull();
  });

  it("undoes the latest action and offers it back as redo", async () => {
    const log: string[] = [];
    const history = new History();
    history.push(entry("A", log));
    history.push(entry("B", log));
    expect(await history.undo()).toBe("B");
    expect(log).toEqual(["undo B"]);
    expect(history.undoLabel).toBe("A");
    expect(history.redoLabel).toBe("B");
  });

  it("redoes what was undone and puts it back on the undo side", async () => {
    const log: string[] = [];
    const history = new History();
    history.push(entry("A", log));
    await history.undo();
    expect(await history.redo()).toBe("A");
    expect(log).toEqual(["undo A", "redo A"]);
    expect(history.undoLabel).toBe("A");
    expect(history.redoLabel).toBeNull();
  });

  it("drops the redo side when a new action lands", async () => {
    const history = new History();
    history.push(entry("A", []));
    await history.undo();
    history.push(entry("B", []));
    expect(history.redoLabel).toBeNull();
  });

  it("returns null when there is nothing to undo or redo", async () => {
    const history = new History();
    expect(await history.undo()).toBeNull();
    expect(await history.redo()).toBeNull();
  });

  it("keeps only the most recent actions", () => {
    const history = new History(2);
    history.push(entry("A", []));
    history.push(entry("B", []));
    history.push(entry("C", []));
    expect(history.undoLabel).toBe("C");
    expect(history.size).toBe(2);
  });

  it("keeps a failed undo on the stack so it can be tried again", async () => {
    const history = new History();
    history.push({
      label: "Bad",
      undo: async () => {
        throw new Error("nope");
      },
      redo: async () => undefined,
    });
    await expect(history.undo()).rejects.toThrow("nope");
    expect(history.undoLabel).toBe("Bad");
  });

  it("refuses to run twice at once", async () => {
    let release: () => void = () => undefined;
    const history = new History();
    history.push({
      label: "Slow",
      undo: () => new Promise<void>((resolve) => (release = resolve)),
      redo: async () => undefined,
    });
    const first = history.undo();
    expect(await history.undo()).toBeNull();
    release();
    expect(await first).toBe("Slow");
  });
});
