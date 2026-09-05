import { describe, expect, it } from "vitest";
import {
  COVER_COUNT,
  fileableFolder,
  folderTileId,
  heightRatioFor,
  partitionWall,
  spanFor,
  validateFolderName,
  widthForDrag,
} from "../src/core/folders";
import type { FolderSpace } from "../src/core/folders";
import type { ClippingRecord } from "../src/core/scan";
import type { TileModel } from "../src/core/tile";

function record(path: string, grid = "", folder = ""): ClippingRecord {
  return {
    path,
    title: path,
    source: "",
    description: "",
    categories: [],
    status: "unread",
    created: "",
    cover: "",
    grid,
    folder,
    media: [],
    haystack: "",
    properties: {},
  };
}

function tile(path: string, grid = "", folder = ""): TileModel {
  return {
    id: path,
    record: record(path, grid, folder),
    posterPath: "",
    filePath: path,
    remote: false,
    kind: "image",
    animated: false,
    width: 100,
    height: 100,
    provisional: false,
    signature: path,
  };
}

const KITCHEN: FolderSpace = { name: "Kitchen", icon: "folder", grid: "", width: 1 };
const FILM: FolderSpace = { name: "Film", icon: "folder", grid: "Design", width: 2 };

describe("partitionWall", () => {
  it("pins the grid's folders first in stored order, then the loose tiles", () => {
    const tiles = [tile("a"), tile("b", "", "Kitchen"), tile("c")];
    const { folders, loose } = partitionWall(tiles, [KITCHEN], "");
    expect(folders.map((f) => f.folder.name)).toEqual(["Kitchen"]);
    expect(folders[0].members.map((m) => m.id)).toEqual(["b"]);
    expect(loose.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("leaves a tile loose when its key names no registered folder", () => {
    const { folders, loose } = partitionWall([tile("a", "", "Gone")], [KITCHEN], "");
    expect(folders[0].members).toEqual([]);
    expect(loose.map((t) => t.id)).toEqual(["a"]);
  });

  it("leaves a tile loose when its key names a folder on another grid", () => {
    const { folders, loose } = partitionWall([tile("a", "", "Film")], [KITCHEN, FILM], "");
    expect(folders.map((f) => f.folder.name)).toEqual(["Kitchen"]);
    expect(loose.map((t) => t.id)).toEqual(["a"]);
  });

  it("keeps an empty folder as a tile", () => {
    const { folders } = partitionWall([], [KITCHEN], "");
    expect(folders).toHaveLength(1);
    expect(folders[0].members).toEqual([]);
  });

  it("matches the folder name exactly, trimmed", () => {
    const { folders } = partitionWall([tile("a", "", " Kitchen ")], [KITCHEN], "");
    expect(folders[0].members.map((m) => m.id)).toEqual(["a"]);
  });

  it("gives each folder tile a stable id", () => {
    const { folders } = partitionWall([], [FILM], "Design");
    expect(folders[0].id).toBe(folderTileId(FILM));
    expect(folders[0].kind).toBe("folder");
  });
});

describe("fileableFolder", () => {
  it("returns the open folder's name when it is registered on the grid", () => {
    expect(fileableFolder("Kitchen", "", [KITCHEN, FILM])).toBe("Kitchen");
  });

  it("returns nothing when no folder is open", () => {
    expect(fileableFolder(null, "", [KITCHEN])).toBe("");
  });

  it("returns nothing when the folder is not on this grid", () => {
    expect(fileableFolder("Film", "", [KITCHEN, FILM])).toBe("");
  });
});

describe("validateFolderName", () => {
  it("refuses an empty name", () => {
    expect(validateFolderName("  ", [])).toBe("A folder needs a name");
  });

  it("refuses a name already used on this grid, ignoring case", () => {
    expect(validateFolderName("kitchen", ["Kitchen"])).toBe(
      "A folder called kitchen already exists here"
    );
  });

  it("lets a folder keep its own name", () => {
    expect(validateFolderName("Kitchen", ["Kitchen"], "Kitchen")).toBeNull();
  });

  it("accepts a fresh name", () => {
    expect(validateFolderName("Bath", ["Kitchen"])).toBeNull();
  });
});

describe("spanFor", () => {
  it("resolves full to the column count", () => {
    expect(spanFor("full", 4)).toBe(4);
  });

  it("clamps a width wider than the wall", () => {
    expect(spanFor(2, 1)).toBe(1);
  });

  it("passes a fitting width through", () => {
    expect(spanFor(2, 3)).toBe(2);
  });
});

describe("heightRatioFor and COVER_COUNT", () => {
  it("has a ratio and a cover count for every width", () => {
    for (const width of [1, 2, "full"] as const) {
      expect(heightRatioFor(width)).toBeGreaterThan(0);
      expect(COVER_COUNT[width]).toBeGreaterThan(0);
    }
  });

  it("shows more covers as the tile widens", () => {
    expect(COVER_COUNT[1]).toBeLessThan(COVER_COUNT[2]);
    expect(COVER_COUNT[2]).toBeLessThan(COVER_COUNT.full);
  });
});

describe("widthForDrag", () => {
  // 100px columns with a 10px gap on a 4-column wall.
  const drag = (start: 1 | 2 | "full", dx: number, columns = 4) =>
    widthForDrag(start, dx, 100, 10, columns);

  it("stays put on a small drag", () => {
    expect(drag(1, 30)).toBe(1);
  });

  it("steps from one to two past half a column", () => {
    expect(drag(1, 60)).toBe(2);
  });

  it("steps from two to full past the next boundary", () => {
    expect(drag(2, 160)).toBe("full");
  });

  it("steps back down when dragged left", () => {
    expect(drag(2, -60)).toBe(1);
    expect(drag("full", -160, 4)).toBe(2);
  });

  it("never goes below one", () => {
    expect(drag(1, -500)).toBe(1);
  });

  it("does nothing on a single-column wall", () => {
    expect(drag(1, 500, 1)).toBe(1);
  });

  it("treats two as full on a two-column wall", () => {
    expect(drag(1, 60, 2)).toBe("full");
  });
});
