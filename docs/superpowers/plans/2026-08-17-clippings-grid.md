# Clippings Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Obsidian plugin that archives every clipping's remote media locally and renders the collection as a fast, filterable masonry grid.

**Architecture:** Pure functions do all the thinking (scanning, URL normalization, image header parsing, masonry math) and import nothing from Obsidian, so they unit-test directly. Obsidian-facing code is a thin shell that injects `requestUrl` and vault I/O as dependencies. The grid virtualizes over a precomputed layout, which is possible because image dimensions are read from file headers at archive time rather than discovered by loading images.

**Tech Stack:** TypeScript, esbuild, Vitest, Obsidian plugin API. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-clippings-grid-design.md`

## Global Constraints

- **The plugin never writes to a note.** Not the body, not the frontmatter. Vault `CLAUDE.md` §9 rule 4 forbids it. Archived filenames are derived from the source URL so nothing needs recording.
- **Pure modules import nothing from `obsidian`.** `src/scan.ts`, `src/normalize.ts`, `src/dimensions.ts`, `src/layout.ts`, `src/hash.ts` must have zero Obsidian imports. This is what makes them testable without mocking the module.
- **Plugin id:** `clippings-grid`. **View type:** `clippings-grid`.
- **Default clippings folder:** `Clippings`. **Default attachment folder:** `Attachments/Clippings`.
- **Default max file size:** 25MB (26214400 bytes). **Default thumbnail width:** 400px.
- **Concurrency cap:** 4 simultaneous downloads.
- **Never delete user files automatically.** Orphan cleanup is an explicit command only.
- **Vault path for dev builds:** `/Users/trevor/Documents/Aegis/.obsidian/plugins/clippings-grid/`

---

### Task 1: Scaffold, build pipeline, and an empty view that opens

**Files:**
- Create: `package.json`, `tsconfig.json`, `manifest.json`, `esbuild.config.mjs`, `vitest.config.ts`, `.gitignore`, `styles.css`
- Create: `src/main.ts`, `src/view.ts`, `src/settings.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VIEW_TYPE_GRID: string`, `ClippingsGridSettings` interface, `DEFAULT_SETTINGS`, `class ClippingsGridPlugin extends Plugin` with `settings: ClippingsGridSettings`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "obsidian-clippings-grid",
  "version": "0.1.0",
  "description": "A fast masonry grid over your Obsidian web clippings, with local media archiving.",
  "main": "main.js",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs --watch",
    "build": "tsc --noEmit && node esbuild.config.mjs --production",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^22.10.2",
    "builtin-modules": "^4.0.0",
    "esbuild": "^0.24.2",
    "obsidian": "^1.7.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "bundler",
    "allowJs": false,
    "noImplicitAny": true,
    "strict": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "isolatedModules": true,
    "importHelpers": false,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `manifest.json`**

```json
{
  "id": "clippings-grid",
  "name": "Clippings Grid",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "A fast masonry grid over your web clippings, with local media archiving so clippings survive link rot.",
  "author": "Trevor Tarakjian",
  "isDesktopOnly": false
}
```

- [ ] **Step 4: Create `esbuild.config.mjs`**

The `VAULT_PLUGIN_DIR` env var controls where dev builds land. It writes a `.hotreload` marker so the installed hot-reload plugin picks up every save.

```js
import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const vaultDir =
  process.env.VAULT_PLUGIN_DIR ||
  "/Users/trevor/Documents/Aegis/.obsidian/plugins/clippings-grid";

const outdir = production ? "dist" : vaultDir;
mkdirSync(outdir, { recursive: true });

function copyStatic() {
  copyFileSync("manifest.json", join(outdir, "manifest.json"));
  copyFileSync("styles.css", join(outdir, "styles.css"));
  if (!production) writeFileSync(join(outdir, ".hotreload"), "");
}

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: join(outdir, "main.js"),
  plugins: [
    {
      name: "copy-static",
      setup(build) {
        build.onEnd(() => copyStatic());
      },
    },
  ],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 6: Create `styles.css` with a placeholder rule**

```css
.clippings-grid-view {
  height: 100%;
  overflow: hidden;
  background: var(--background-primary);
}
```

- [ ] **Step 7: Create `src/settings.ts`**

```ts
export interface ClippingsGridSettings {
  clippingsFolder: string;
  attachmentFolder: string;
  archiveOnCreate: boolean;
  autoplayVideo: boolean;
  maxBytes: number;
  thumbnailWidth: number;
}

export const DEFAULT_SETTINGS: ClippingsGridSettings = {
  clippingsFolder: "Clippings",
  attachmentFolder: "Attachments/Clippings",
  archiveOnCreate: true,
  autoplayVideo: true,
  maxBytes: 26214400,
  thumbnailWidth: 400,
};
```

- [ ] **Step 8: Create `src/view.ts` with an empty view**

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_GRID = "clippings-grid";

export class ClippingsGridView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GRID;
  }

  getDisplayText(): string {
    return "Clippings grid";
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("clippings-grid-view");
    this.contentEl.createEl("p", { text: "Clippings grid is alive." });
  }
}
```

- [ ] **Step 9: Create `src/main.ts`**

```ts
import { Plugin, WorkspaceLeaf } from "obsidian";
import { ClippingsGridSettings, DEFAULT_SETTINGS } from "./settings";
import { ClippingsGridView, VIEW_TYPE_GRID } from "./view";

export default class ClippingsGridPlugin extends Plugin {
  settings: ClippingsGridSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_GRID,
      (leaf: WorkspaceLeaf) => new ClippingsGridView(leaf)
    );

    this.addRibbonIcon("layout-grid", "Open clippings grid", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-clippings-grid",
      name: "Open clippings grid",
      callback: () => void this.activateView(),
    });
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_GRID, active: true });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 10: Create `tests/smoke.test.ts` to prove the test runner works**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("settings", () => {
  it("defaults to the Clippings folder", () => {
    expect(DEFAULT_SETTINGS.clippingsFolder).toBe("Clippings");
  });

  it("caps files at 25MB", () => {
    expect(DEFAULT_SETTINGS.maxBytes).toBe(25 * 1024 * 1024);
  });
});
```

- [ ] **Step 11: Install and verify**

Run: `npm install && npm test`
Expected: 2 tests pass.

Run: `npm run build`
Expected: no TypeScript errors, `dist/main.js` written.

- [ ] **Step 12: Build into the vault and confirm in Obsidian**

Run: `npm run dev` (leave running)
Expected: `main.js`, `manifest.json`, `styles.css`, `.hotreload` appear in `/Users/trevor/Documents/Aegis/.obsidian/plugins/clippings-grid/`.

Then in Obsidian: Settings, Community plugins, enable "Clippings Grid". Click the grid ribbon icon.
Expected: a tab opens reading "Clippings grid is alive."

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: scaffold plugin with build pipeline and empty grid view"
```

---

### Task 2: Scanner

**Files:**
- Create: `src/scan.ts`
- Test: `tests/scan.test.ts`, `tests/fixtures/clippings.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MediaRef`, `ClippingRecord`, `scanClipping(path: string, frontmatter: Record<string, unknown>, body: string): ClippingRecord`.

- [ ] **Step 1: Create fixtures from the three real clippings**

Create `tests/fixtures/clippings.ts`:

```ts
export const COMBOLANDS_FM = {
  title: "Cities: Skylines meets Balatro in Steam's coolest new roguelike in years",
  source: "https://www.polygon.com/combolands-demo-preview-impressions/",
  description: "Combolands combines the combo-chaining thrills of Balatro with the strategic placement of Cities: Skylines",
  created: "2026-08-14",
  tags: ["clippings"],
  type: "clipping",
  categories: ["games", "roguelike", "indie"],
  status: "unread",
};

export const COMBOLANDS_BODY = `
Quite a few developers have tried to recreate LocalThunk's success.

![A snowy city in Combolands](https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-7.jpg?q=49&fit=contain&w=750&h=422&dpr=2)

![An early city in Combolands](https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-6.jpg?q=49&fit=contain&w=750&h=422&dpr=2)

![A snowy city in Combolands](https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-7.jpg?q=49&fit=contain&w=1920&h=1080&dpr=2)

![An early city in Combolands](https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-6.jpg?q=49&fit=contain&w=1920&h=1080&dpr=2)
`;

export const MANGA_FM = {
  title: "elboletaire/manga-downloader: Download manga from 80+ sites",
  source: "https://github.com/elboletaire/manga-downloader#supported-sites",
  description: "Download manga (and comics) from over 80+ online reading websites",
  created: "2026-08-17",
  tags: ["clippings"],
  type: "clipping",
  categories: ["tools", "manga", "cli"],
  status: "unread",
};

export const MANGA_BODY = `
## Manga Downloader

[![prompt img](https://raw.githubusercontent.com/elboletaire/manga-downloader/master/demos/prompt.gif)](https://raw.githubusercontent.com/elboletaire/manga-downloader/master/demos/prompt.gif)

<img src="https://raw.githubusercontent.com/elboletaire/manga-downloader/master/demos/download.gif" alt="download img">

\`\`\`
manga-downloader https://mangadex.org/title/abc/one-piece 1-10
\`\`\`
`;

export const NOOK_FM = {
  title: "Nook - Write mode by Jay Bong",
  source: "https://www.spottedinprod.com/bonxn/clips/797",
  description: "Spotted in Prod is a curated collection of standout iOS apps and interactions.",
  created: "2026-08-14",
  tags: ["clippings"],
  type: "clipping",
  categories: ["design", "ios", "interaction"],
  status: "unread",
};

export const NOOK_BODY = `
<video src="https://cdn.spottedinprod.com/community-clips/19305/797/1786251277681-transcoded.mp4" controls=""></video>

Nook - Write mode by Jay Bong
`;
```

- [ ] **Step 2: Write the failing tests**

Create `tests/scan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/scan";
import {
  COMBOLANDS_BODY, COMBOLANDS_FM,
  MANGA_BODY, MANGA_FM,
  NOOK_BODY, NOOK_FM,
} from "./fixtures/clippings";

describe("scanClipping", () => {
  it("pulls metadata off the clipper frontmatter", () => {
    const r = scanClipping("Clippings/Combolands.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    expect(r.path).toBe("Clippings/Combolands.md");
    expect(r.title).toContain("Cities: Skylines");
    expect(r.source).toBe("https://www.polygon.com/combolands-demo-preview-impressions/");
    expect(r.categories).toEqual(["games", "roguelike", "indie"]);
    expect(r.status).toBe("unread");
    expect(r.created).toBe("2026-08-14");
  });

  it("finds markdown images in document order", () => {
    const r = scanClipping("Clippings/Combolands.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    expect(r.media).toHaveLength(4);
    expect(r.media[0].kind).toBe("image");
    expect(r.media[0].alt).toBe("A snowy city in Combolands");
    expect(r.media[0].url).toContain("combolands-7.jpg");
  });

  it("parses the width hint out of the query string", () => {
    const r = scanClipping("Clippings/Combolands.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    expect(r.media[0].widthHint).toBe(750);
    expect(r.media[2].widthHint).toBe(1920);
  });

  it("finds both markdown and html images, and ignores fenced code", () => {
    const r = scanClipping("Clippings/Manga.md", MANGA_FM, MANGA_BODY);
    expect(r.media).toHaveLength(2);
    expect(r.media[0].url).toContain("prompt.gif");
    expect(r.media[1].url).toContain("download.gif");
    expect(r.media[1].alt).toBe("download img");
    expect(r.media.some((m) => m.url.includes("mangadex.org"))).toBe(false);
  });

  it("finds video tags", () => {
    const r = scanClipping("Clippings/Nook.md", NOOK_FM, NOOK_BODY);
    expect(r.media).toHaveLength(1);
    expect(r.media[0].kind).toBe("video");
    expect(r.media[0].url).toContain(".mp4");
  });

  it("builds a lowercase search haystack from title, description and domain", () => {
    const r = scanClipping("Clippings/Nook.md", NOOK_FM, NOOK_BODY);
    expect(r.haystack).toContain("nook - write mode");
    expect(r.haystack).toContain("spottedinprod.com");
    expect(r.haystack).toContain("design");
  });

  it("skips data URIs and vault-relative links", () => {
    const body = "![a](data:image/png;base64,AAAA)\n![b](Attachments/local.png)\n![[embed.png]]";
    const r = scanClipping("Clippings/X.md", NOOK_FM, body);
    expect(r.media).toHaveLength(0);
  });

  it("tolerates missing frontmatter fields", () => {
    const r = scanClipping("Clippings/X.md", {}, "");
    expect(r.title).toBe("X");
    expect(r.categories).toEqual([]);
    expect(r.status).toBe("unread");
    expect(r.media).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/scan.test.ts`
Expected: FAIL, cannot resolve `../src/scan`.

- [ ] **Step 4: Implement `src/scan.ts`**

```ts
export interface MediaRef {
  url: string;
  kind: "image" | "video";
  alt: string;
  widthHint?: number;
}

export interface ClippingRecord {
  path: string;
  title: string;
  source: string;
  description: string;
  categories: string[];
  status: string;
  created: string;
  media: MediaRef[];
  haystack: string;
}

const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<?)([^)\s>]+)\2(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HTML_VIDEO = /<video\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HTML_ALT = /\balt\s*=\s*["']([^"']*)["']/i;
const FENCED_CODE = /(^|\n)(```|~~~)[\s\S]*?\n\2[ \t]*(?=\n|$)/g;

function stripCode(body: string): string {
  return body.replace(FENCED_CODE, (m) => m.replace(/[^\n]/g, " "));
}

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function widthHint(url: string): number | undefined {
  const match = /[?&](?:w|width)=(\d+)/i.exec(url);
  return match ? Number(match[1]) : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function basename(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

export function scanClipping(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string
): ClippingRecord {
  const clean = stripCode(body);
  const found: Array<{ index: number; ref: MediaRef }> = [];
  const seen = new Set<string>();

  const push = (index: number, url: string, kind: MediaRef["kind"], alt: string) => {
    if (!isRemote(url) || seen.has(url + kind)) return;
    seen.add(url + kind);
    found.push({ index, ref: { url, kind, alt, widthHint: widthHint(url) } });
  };

  for (const m of clean.matchAll(MD_IMAGE)) {
    push(m.index ?? 0, m[3], "image", m[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_IMAGE)) {
    push(m.index ?? 0, m[1], "image", HTML_ALT.exec(m[0])?.[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_VIDEO)) {
    push(m.index ?? 0, m[1], "video", HTML_ALT.exec(m[0])?.[1] ?? "");
  }

  found.sort((a, b) => a.index - b.index);
  const media = found.map((f) => f.ref);

  const title = str(frontmatter.title) || basename(path);
  const source = str(frontmatter.source);
  const description = str(frontmatter.description);
  const categories = asStringArray(frontmatter.categories);
  const status = str(frontmatter.status, "unread") || "unread";
  const created = str(frontmatter.created);

  const haystack = [title, description, domainOf(source), ...categories, status]
    .join(" ")
    .toLowerCase();

  return { path, title, source, description, categories, status, created, media, haystack };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/scan.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scan.ts tests/scan.test.ts tests/fixtures/clippings.ts
git commit -m "feat: scan clippings into records with media refs"
```

---

### Task 3: URL normalizer and dedupe

**Files:**
- Create: `src/normalize.ts`, `src/hash.ts`
- Test: `tests/normalize.test.ts`, `tests/hash.test.ts`

**Interfaces:**
- Consumes: `MediaRef` from `src/scan.ts`.
- Produces: `normalizeUrl(url: string): string`, `CanonicalMedia { key: string; url: string; kind: "image" | "video"; alt: string }`, `dedupeMedia(refs: MediaRef[]): CanonicalMedia[]`, `hashUrl(key: string): string` (12 lowercase hex chars).

- [ ] **Step 1: Write the failing tests**

Create `tests/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashUrl } from "../src/hash";

describe("hashUrl", () => {
  it("returns 12 lowercase hex characters", () => {
    expect(hashUrl("https://example.com/a.jpg")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable across calls", () => {
    const a = hashUrl("https://example.com/a.jpg");
    const b = hashUrl("https://example.com/a.jpg");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    expect(hashUrl("https://example.com/a.jpg")).not.toBe(hashUrl("https://example.com/b.jpg"));
  });

  it("has no collisions across ten thousand generated urls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) seen.add(hashUrl(`https://example.com/img-${i}.jpg`));
    expect(seen.size).toBe(10000);
  });
});
```

Create `tests/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dedupeMedia, normalizeUrl } from "../src/normalize";
import { scanClipping } from "../src/scan";
import { COMBOLANDS_BODY, COMBOLANDS_FM } from "./fixtures/clippings";

describe("normalizeUrl", () => {
  it("strips sizing query parameters", () => {
    expect(normalizeUrl("https://x.com/a.jpg?q=49&fit=contain&w=750&h=422&dpr=2"))
      .toBe("https://x.com/a.jpg");
  });

  it("collapses the same asset requested at two sizes", () => {
    const small = normalizeUrl("https://x.com/a.jpg?w=750&h=422&dpr=2");
    const large = normalizeUrl("https://x.com/a.jpg?w=1920&h=1080&dpr=2");
    expect(small).toBe(large);
  });

  it("keeps query parameters that are not about size", () => {
    expect(normalizeUrl("https://x.com/a.jpg?token=abc")).toBe("https://x.com/a.jpg?token=abc");
  });

  it("drops the fragment and lowercases the host", () => {
    expect(normalizeUrl("https://X.COM/a.jpg#frag")).toBe("https://x.com/a.jpg");
  });

  it("returns the input unchanged when it will not parse", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("dedupeMedia", () => {
  it("collapses Combolands duplicates and keeps the largest variant", () => {
    const record = scanClipping("Clippings/C.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    const canonical = dedupeMedia(record.media);
    expect(canonical).toHaveLength(2);
    expect(canonical[0].url).toContain("w=1920");
    expect(canonical[1].url).toContain("w=1920");
  });

  it("preserves first-appearance order", () => {
    const record = scanClipping("Clippings/C.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    const canonical = dedupeMedia(record.media);
    expect(canonical[0].url).toContain("combolands-7.jpg");
    expect(canonical[1].url).toContain("combolands-6.jpg");
  });

  it("keys each entry by the normalized url", () => {
    const canonical = dedupeMedia([
      { url: "https://x.com/a.jpg?w=750", kind: "image", alt: "", widthHint: 750 },
    ]);
    expect(canonical[0].key).toBe("https://x.com/a.jpg");
  });

  it("keeps the first alt text it saw", () => {
    const canonical = dedupeMedia([
      { url: "https://x.com/a.jpg?w=750", kind: "image", alt: "first", widthHint: 750 },
      { url: "https://x.com/a.jpg?w=1920", kind: "image", alt: "second", widthHint: 1920 },
    ]);
    expect(canonical[0].alt).toBe("first");
    expect(canonical[0].url).toContain("w=1920");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hash.test.ts tests/normalize.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/hash.ts`**

cyrb53 gives 53 bits, which at ten thousand URLs leaves collision probability around 5e-9. Synchronous, so the render-repair path can hash without awaiting.

```ts
export function hashUrl(key: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0").slice(-12);
}
```

- [ ] **Step 4: Implement `src/normalize.ts`**

```ts
import type { MediaRef } from "./scan";

export interface CanonicalMedia {
  key: string;
  url: string;
  kind: "image" | "video";
  alt: string;
}

const SIZING_PARAMS = new Set([
  "w", "width", "h", "height", "dpr", "q", "quality", "fit", "resize", "s", "size", "fm",
]);

export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  for (const name of [...parsed.searchParams.keys()]) {
    if (SIZING_PARAMS.has(name.toLowerCase())) parsed.searchParams.delete(name);
  }
  let out = parsed.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

export function dedupeMedia(refs: MediaRef[]): CanonicalMedia[] {
  const order: string[] = [];
  const best = new Map<string, { ref: MediaRef; alt: string }>();

  for (const ref of refs) {
    const key = normalizeUrl(ref.url);
    const existing = best.get(key);
    if (!existing) {
      order.push(key);
      best.set(key, { ref, alt: ref.alt });
      continue;
    }
    const currentWidth = existing.ref.widthHint ?? 0;
    const candidateWidth = ref.widthHint ?? 0;
    if (candidateWidth > currentWidth) {
      best.set(key, { ref, alt: existing.alt });
    }
  }

  return order.map((key) => {
    const entry = best.get(key)!;
    return { key, url: entry.ref.url, kind: entry.ref.kind, alt: entry.alt };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/hash.test.ts tests/normalize.test.ts`
Expected: 9 tests PASS. The Combolands case collapsing 4 refs to 2 is the one that matters.

- [ ] **Step 6: Commit**

```bash
git add src/hash.ts src/normalize.ts tests/hash.test.ts tests/normalize.test.ts
git commit -m "feat: normalize and dedupe media urls by stripping sizing params"
```

---

### Task 4: Clipping index, wired into the view as a plain list

This is the first milestone you can look at in Obsidian with your real data.

**Files:**
- Create: `src/index-store.ts`
- Modify: `src/view.ts`, `src/main.ts`
- Test: `tests/index-store.test.ts`

**Interfaces:**
- Consumes: `scanClipping`, `ClippingRecord`.
- Produces: `class ClippingIndex` with `records(): ClippingRecord[]`, `get(path: string): ClippingRecord | undefined`, `rebuild(): Promise<void>`, `onChange(cb: () => void): void`. Constructor takes `(app: App, folder: () => string)`.

- [ ] **Step 1: Write the failing test for the pure sorting and filtering part**

Create `tests/index-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isInFolder, sortRecords } from "../src/index-store";
import type { ClippingRecord } from "../src/scan";

function rec(path: string, created: string, title: string): ClippingRecord {
  return {
    path, created, title,
    source: "", description: "", categories: [], status: "unread",
    media: [], haystack: title.toLowerCase(),
  };
}

describe("isInFolder", () => {
  it("accepts markdown files directly inside the folder", () => {
    expect(isInFolder("Clippings/A.md", "Clippings")).toBe(true);
  });

  it("accepts nested markdown files", () => {
    expect(isInFolder("Clippings/sub/A.md", "Clippings")).toBe(true);
  });

  it("rejects other folders", () => {
    expect(isInFolder("Work/A.md", "Clippings")).toBe(false);
  });

  it("rejects files whose name starts with an underscore", () => {
    expect(isInFolder("Clippings/_Categories.md", "Clippings")).toBe(false);
  });

  it("rejects non-markdown files", () => {
    expect(isInFolder("Clippings/Clippings.base", "Clippings")).toBe(false);
  });

  it("is not fooled by a folder with a shared prefix", () => {
    expect(isInFolder("ClippingsOld/A.md", "Clippings")).toBe(false);
  });
});

describe("sortRecords", () => {
  it("orders newest created first", () => {
    const sorted = sortRecords([
      rec("a.md", "2026-01-01", "A"),
      rec("b.md", "2026-08-01", "B"),
    ]);
    expect(sorted[0].path).toBe("b.md");
  });

  it("falls back to title when created dates match", () => {
    const sorted = sortRecords([
      rec("b.md", "2026-01-01", "Beta"),
      rec("a.md", "2026-01-01", "Alpha"),
    ]);
    expect(sorted[0].title).toBe("Alpha");
  });

  it("puts records with no created date last", () => {
    const sorted = sortRecords([rec("a.md", "", "A"), rec("b.md", "2026-01-01", "B")]);
    expect(sorted[0].path).toBe("b.md");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/index-store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/index-store.ts`**

```ts
import { App, TFile } from "obsidian";
import { ClippingRecord, scanClipping } from "./scan";

export function isInFolder(path: string, folder: string): boolean {
  if (!path.toLowerCase().endsWith(".md")) return false;
  const prefix = folder.endsWith("/") ? folder : folder + "/";
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return !name.startsWith("_");
}

export function sortRecords(records: ClippingRecord[]): ClippingRecord[] {
  return [...records].sort((a, b) => {
    if (a.created !== b.created) {
      if (!a.created) return 1;
      if (!b.created) return -1;
      return a.created < b.created ? 1 : -1;
    }
    return a.title.localeCompare(b.title);
  });
}

export class ClippingIndex {
  private byPath = new Map<string, ClippingRecord>();
  private listeners: Array<() => void> = [];

  constructor(private app: App, private folder: () => string) {}

  records(): ClippingRecord[] {
    return sortRecords([...this.byPath.values()]);
  }

  get(path: string): ClippingRecord | undefined {
    return this.byPath.get(path);
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  async rebuild(): Promise<void> {
    this.byPath.clear();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => isInFolder(f.path, this.folder()));
    for (const file of files) await this.ingest(file);
    this.emit();
  }

  async ingest(file: TFile): Promise<void> {
    if (!isInFolder(file.path, this.folder())) return;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const body = await this.app.vault.cachedRead(file);
    this.byPath.set(file.path, scanClipping(file.path, frontmatter, body));
  }

  async handleModify(file: TFile): Promise<void> {
    await this.ingest(file);
    this.emit();
  }

  handleDelete(path: string): void {
    if (this.byPath.delete(path)) this.emit();
  }

  async handleRename(file: TFile, oldPath: string): Promise<void> {
    this.byPath.delete(oldPath);
    await this.ingest(file);
    this.emit();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/index-store.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Wire the index into `src/main.ts`**

Add to imports and `onload`, after `await this.loadSettings()`:

```ts
import { TAbstractFile, TFile } from "obsidian";
import { ClippingIndex } from "./index-store";
```

```ts
    this.index = new ClippingIndex(this.app, () => this.settings.clippingsFolder);

    this.app.workspace.onLayoutReady(() => void this.index.rebuild());

    this.registerEvent(
      this.app.vault.on("create", (f: TAbstractFile) => {
        if (f instanceof TFile) void this.index.handleModify(f);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (f: TAbstractFile) => {
        if (f instanceof TFile) void this.index.handleModify(f);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f: TAbstractFile) => this.index.handleDelete(f.path))
    );
    this.registerEvent(
      this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
        if (f instanceof TFile) void this.index.handleRename(f, oldPath);
      })
    );
```

Declare the field on the class: `index!: ClippingIndex;`

Change the view registration to pass the plugin through:

```ts
    this.registerView(
      VIEW_TYPE_GRID,
      (leaf: WorkspaceLeaf) => new ClippingsGridView(leaf, this)
    );
```

- [ ] **Step 6: Render a plain list in `src/view.ts`**

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import type ClippingsGridPlugin from "./main";

export const VIEW_TYPE_GRID = "clippings-grid";

export class ClippingsGridView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClippingsGridPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_GRID; }
  getDisplayText(): string { return "Clippings grid"; }
  getIcon(): string { return "layout-grid"; }

  async onOpen(): Promise<void> {
    this.plugin.index.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass("clippings-grid-view");
    const records = this.plugin.index.records();
    el.createEl("p", { text: `${records.length} clippings` });
    const list = el.createEl("ul");
    for (const r of records) {
      list.createEl("li", {
        text: `${r.title} — ${r.media.length} media — ${r.categories.join(", ")}`,
      });
    }
  }
}
```

- [ ] **Step 7: Verify in the vault**

With `npm run dev` running, reload Obsidian (Cmd+R) and open the grid.
Expected: "3 clippings" and three list rows. Combolands shows 12 media, manga-downloader shows 5, Nook shows 1. Those are pre-dedupe counts, which is correct at this stage.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: index clippings from the vault and list them in the view"
```

---

### Task 5: Image header dimension parser

**Files:**
- Create: `src/dimensions.ts`
- Test: `tests/dimensions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Dimensions { width: number; height: number }`, `readDimensions(buf: ArrayBuffer): Dimensions | null`.

- [ ] **Step 1: Write the failing tests with hand-built headers**

Create `tests/dimensions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readDimensions } from "../src/dimensions";

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function pngHeader(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b.buffer;
}

function gifHeader(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(b.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return b.buffer;
}

function jpegHeader(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(24);
  const view = new DataView(b.buffer);
  b.set([0xff, 0xd8], 0);
  b.set([0xff, 0xe0], 2);
  view.setUint16(4, 6);
  b.set([0xff, 0xc0], 10);
  view.setUint16(12, 11);
  b[14] = 8;
  view.setUint16(15, height);
  view.setUint16(17, width);
  return b.buffer;
}

function webpVp8x(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(30);
  const enc = new TextEncoder();
  b.set(enc.encode("RIFF"), 0);
  b.set(enc.encode("WEBP"), 8);
  b.set(enc.encode("VP8X"), 12);
  const w = width - 1;
  const h = height - 1;
  b[24] = w & 0xff; b[25] = (w >> 8) & 0xff; b[26] = (w >> 16) & 0xff;
  b[27] = h & 0xff; b[28] = (h >> 8) & 0xff; b[29] = (h >> 16) & 0xff;
  return b.buffer;
}

describe("readDimensions", () => {
  it("reads PNG", () => {
    expect(readDimensions(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("reads GIF", () => {
    expect(readDimensions(gifHeader(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("reads JPEG from the SOF0 marker", () => {
    expect(readDimensions(jpegHeader(750, 422))).toEqual({ width: 750, height: 422 });
  });

  it("reads WebP VP8X", () => {
    expect(readDimensions(webpVp8x(1200, 900))).toEqual({ width: 1200, height: 900 });
  });

  it("returns null for an unknown format", () => {
    expect(readDimensions(bytes(1, 2, 3, 4, 5, 6, 7, 8))).toBeNull();
  });

  it("returns null for a truncated file rather than throwing", () => {
    const full = new Uint8Array(pngHeader(100, 100));
    expect(readDimensions(full.slice(0, 12).buffer)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(readDimensions(new ArrayBuffer(0))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dimensions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/dimensions.ts`**

```ts
export interface Dimensions {
  width: number;
  height: number;
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function png(bytes: Uint8Array, view: DataView): Dimensions | null {
  if (bytes.length < 24) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gif(bytes: Uint8Array, view: DataView): Dimensions | null {
  if (bytes.length < 10) return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function jpeg(bytes: Uint8Array, view: DataView): Dimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (SOF_MARKERS.has(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function webp(bytes: Uint8Array, view: DataView): Dimensions | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);

  if (chunk === "VP8X") {
    const w = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
    const h = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
    return { width: w + 1, height: h + 1 };
  }

  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

export function readDimensions(buf: ArrayBuffer): Dimensions | null {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12) return null;
  const view = new DataView(buf);

  try {
    if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return png(bytes, view);
    if (ascii(bytes, 0, 3) === "GIF") return gif(bytes, view);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes, view);
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return webp(bytes, view);
  } catch {
    return null;
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dimensions.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dimensions.ts tests/dimensions.test.ts
git commit -m "feat: read image dimensions from file headers without decoding"
```

---

### Task 6: Masonry layout math and virtualization range

**Files:**
- Create: `src/layout.ts`
- Test: `tests/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LayoutItem { id: string; width: number; height: number }`, `Position { id: string; x: number; y: number; w: number; h: number }`, `LayoutResult { positions: Position[]; totalHeight: number }`, `computeLayout(items, containerWidth, columns, gap): LayoutResult`, `columnsForWidth(containerWidth, targetColumnWidth, gap): number`, `visibleRange(positions, scrollTop, viewportHeight, overscan): Position[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { columnsForWidth, computeLayout, visibleRange } from "../src/layout";
import type { LayoutItem } from "../src/layout";

const square = (id: string): LayoutItem => ({ id, width: 100, height: 100 });

describe("columnsForWidth", () => {
  it("fits as many target-width columns as it can", () => {
    expect(columnsForWidth(1000, 300, 16)).toBe(3);
  });

  it("never returns fewer than one column", () => {
    expect(columnsForWidth(100, 300, 16)).toBe(1);
  });
});

describe("computeLayout", () => {
  it("divides the container evenly, accounting for gaps", () => {
    const { positions } = computeLayout([square("a"), square("b")], 1016, 2, 16);
    expect(positions[0].w).toBe(500);
    expect(positions[0].x).toBe(0);
    expect(positions[1].x).toBe(516);
  });

  it("scales height to preserve aspect ratio", () => {
    const { positions } = computeLayout([{ id: "a", width: 1000, height: 500 }], 500, 1, 0);
    expect(positions[0].w).toBe(500);
    expect(positions[0].h).toBe(250);
  });

  it("places each item in the shortest column", () => {
    const items: LayoutItem[] = [
      { id: "tall", width: 100, height: 400 },
      { id: "short", width: 100, height: 100 },
      { id: "next", width: 100, height: 100 },
    ];
    const { positions } = computeLayout(items, 200, 2, 0);
    const next = positions.find((p) => p.id === "next")!;
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
  });

  it("reports total height as the tallest column", () => {
    const items: LayoutItem[] = [
      { id: "a", width: 100, height: 300 },
      { id: "b", width: 100, height: 100 },
    ];
    const { totalHeight } = computeLayout(items, 200, 2, 0);
    expect(totalHeight).toBe(300);
  });

  it("is deterministic: same input, same positions", () => {
    const items = [square("a"), square("b"), square("c")];
    const first = computeLayout(items, 500, 3, 8);
    const second = computeLayout(items, 500, 3, 8);
    expect(first).toEqual(second);
  });

  it("never overlaps two items in the same column", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `i${i}`, width: 100, height: 50 + (i % 7) * 30,
    }));
    const { positions } = computeLayout(items, 400, 4, 10);
    for (const a of positions) {
      for (const b of positions) {
        if (a.id === b.id || a.x !== b.x) continue;
        const overlaps = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("handles an empty list", () => {
    expect(computeLayout([], 500, 3, 8)).toEqual({ positions: [], totalHeight: 0 });
  });

  it("falls back to a square for zero-dimension items", () => {
    const { positions } = computeLayout([{ id: "a", width: 0, height: 0 }], 300, 1, 0);
    expect(positions[0].h).toBe(300);
  });
});

describe("visibleRange", () => {
  const positions = Array.from({ length: 100 }, (_, i) => ({
    id: `i${i}`, x: 0, y: i * 100, w: 100, h: 100,
  }));

  it("returns only what intersects the viewport plus overscan", () => {
    const visible = visibleRange(positions, 1000, 500, 200);
    expect(visible[0].y).toBe(800);
    expect(visible[visible.length - 1].y).toBe(1700);
  });

  it("clamps at the top", () => {
    const visible = visibleRange(positions, 0, 300, 200);
    expect(visible[0].id).toBe("i0");
  });

  it("clamps at the bottom", () => {
    const visible = visibleRange(positions, 9500, 500, 200);
    expect(visible[visible.length - 1].id).toBe("i99");
  });

  it("returns nothing for an empty layout", () => {
    expect(visibleRange([], 0, 500, 200)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/layout.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/layout.ts`**

```ts
export interface LayoutItem {
  id: string;
  width: number;
  height: number;
}

export interface Position {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  positions: Position[];
  totalHeight: number;
}

export function columnsForWidth(
  containerWidth: number,
  targetColumnWidth: number,
  gap: number
): number {
  const count = Math.floor((containerWidth + gap) / (targetColumnWidth + gap));
  return Math.max(1, count);
}

export function computeLayout(
  items: LayoutItem[],
  containerWidth: number,
  columns: number,
  gap: number
): LayoutResult {
  if (items.length === 0) return { positions: [], totalHeight: 0 };

  const columnCount = Math.max(1, columns);
  const columnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
  const heights = new Array<number>(columnCount).fill(0);
  const positions: Position[] = [];

  for (const item of items) {
    let target = 0;
    for (let c = 1; c < columnCount; c++) {
      if (heights[c] < heights[target] - 0.01) target = c;
    }

    const ratio = item.width > 0 && item.height > 0 ? item.height / item.width : 1;
    const h = Math.round(columnWidth * ratio);
    const x = Math.round(target * (columnWidth + gap));
    const y = Math.round(heights[target]);

    positions.push({ id: item.id, x, y, w: Math.round(columnWidth), h });
    heights[target] = y + h + gap;
  }

  const totalHeight = Math.max(0, Math.max(...heights) - gap);
  return { positions, totalHeight };
}

export function visibleRange(
  positions: Position[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): Position[] {
  const top = scrollTop - overscan;
  const bottom = scrollTop + viewportHeight + overscan;
  return positions.filter((p) => p.y + p.h >= top && p.y <= bottom);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/layout.test.ts`
Expected: 14 tests PASS. The no-overlap and determinism tests are the load-bearing ones.

- [ ] **Step 5: Commit**

```bash
git add src/layout.ts tests/layout.test.ts
git commit -m "feat: masonry layout math and virtualization range"
```

---

### Task 7: Archiver

**Files:**
- Create: `src/archive.ts`
- Test: `tests/archive.test.ts`

**Interfaces:**
- Consumes: `CanonicalMedia`, `hashUrl`, `readDimensions`.
- Produces: `ArchiveOutcome`, `ArchiveDeps`, `Fetcher`, `FetchResult { status: number; arrayBuffer: ArrayBuffer; contentType?: string }`, `archiveOne(media, referer, deps): Promise<ArchiveOutcome>`, `archiveAll(list, referer, deps, concurrency): Promise<ArchiveOutcome[]>`, `archiveFilename(media): string`.

**Note added after Task 2 verified the scanner against the real vault:** one real clipping embeds `![...](https://www.youtube.com/watch?v=BZZoL_IoBZs)`, a page URL written with markdown image syntax. The archiver must reject responses whose `Content-Type` is not an image or video, or it will save an HTML document as a `.jpg`.

- [ ] **Step 1: Write the failing tests**

Create `tests/archive.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { archiveAll, archiveFilename, archiveOne } from "../src/archive";
import type { ArchiveDeps, Fetcher } from "../src/archive";
import type { CanonicalMedia } from "../src/normalize";

function pngBuffer(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b.buffer;
}

const media: CanonicalMedia = {
  key: "https://x.com/a.jpg",
  url: "https://x.com/a.jpg?w=1920",
  kind: "image",
  alt: "a",
};

function deps(overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    fetch: vi.fn(async () => ({ status: 200, arrayBuffer: pngBuffer(1920, 1080) })),
    exists: vi.fn(async () => false),
    write: vi.fn(async () => {}),
    folder: "Attachments/Clippings",
    maxBytes: 26214400,
    ...overrides,
  };
}

describe("archiveFilename", () => {
  it("combines a url hash with the original basename", () => {
    const name = archiveFilename(media);
    expect(name).toMatch(/^[0-9a-f]{12}-a\.jpg$/);
  });

  it("is stable across size variants of the same asset", () => {
    const small = archiveFilename({ ...media, url: "https://x.com/a.jpg?w=750" });
    const large = archiveFilename({ ...media, url: "https://x.com/a.jpg?w=1920" });
    expect(small).toBe(large);
  });

  it("sanitizes characters that are illegal in filenames", () => {
    const name = archiveFilename({ ...media, url: "https://x.com/a b:c*.jpg" });
    expect(name).not.toMatch(/[:*\s]/);
  });

  it("supplies an extension when the url has none", () => {
    const name = archiveFilename({ ...media, url: "https://x.com/image" });
    expect(name).toMatch(/\.jpg$/);
  });

  it("uses mp4 for video with no extension", () => {
    const name = archiveFilename({ ...media, kind: "video", url: "https://x.com/clip" });
    expect(name).toMatch(/\.mp4$/);
  });
});

describe("archiveOne", () => {
  it("writes the file and reports dimensions read from the header", async () => {
    const d = deps();
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toBeUndefined();
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
    expect(out.file).toBe(`Attachments/Clippings/${archiveFilename(media)}`);
    expect(d.write).toHaveBeenCalledOnce();
  });

  it("keys the outcome by the normalized url", async () => {
    const out = await archiveOne(media, "https://ref", deps());
    expect(out.key).toBe("https://x.com/a.jpg");
  });

  it("skips the download when the file already exists", async () => {
    const d = deps({ exists: vi.fn(async () => true) });
    const out = await archiveOne(media, "https://ref", d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
    expect(out.file).toBeDefined();
  });

  it("retries once with a Referer header after a 403", async () => {
    const fetch = vi.fn<Fetcher>()
      .mockResolvedValueOnce({ status: 403, arrayBuffer: new ArrayBuffer(0) })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: pngBuffer(10, 10) });
    const d = deps({ fetch });
    const out = await archiveOne(media, "https://polygon.com/article", d);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("Referer");
    expect(fetch.mock.calls[1][1].Referer).toBe("https://polygon.com/article");
    expect(out.failed).toBeUndefined();
  });

  it("gives up after the retry also fails", async () => {
    const fetch = vi.fn(async () => ({ status: 403, arrayBuffer: new ArrayBuffer(0) }));
    const out = await archiveOne(media, "https://ref", deps({ fetch }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(out.failed).toContain("403");
    expect(out.file).toBeUndefined();
  });

  it("does not retry a 404", async () => {
    const fetch = vi.fn(async () => ({ status: 404, arrayBuffer: new ArrayBuffer(0) }));
    const out = await archiveOne(media, "https://ref", deps({ fetch }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(out.failed).toContain("404");
  });

  it("refuses a response that is not image or video content", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({
        status: 200,
        arrayBuffer: new TextEncoder().encode("<!doctype html><html>").buffer,
        contentType: "text/html; charset=utf-8",
      })),
    });
    const out = await archiveOne(
      { ...media, url: "https://www.youtube.com/watch?v=BZZoL_IoBZs" },
      "https://ref",
      d
    );
    expect(out.failed).toContain("text/html");
    expect(d.write).not.toHaveBeenCalled();
  });

  it("accepts a response with no content-type rather than guessing", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: pngBuffer(10, 10) })),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toBeUndefined();
    expect(d.write).toHaveBeenCalledOnce();
  });

  it("refuses files over the size cap without writing them", async () => {
    const d = deps({
      maxBytes: 100,
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: new ArrayBuffer(500) })),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toContain("too large");
    expect(d.write).not.toHaveBeenCalled();
  });

  it("records a network error as a failure rather than throwing", async () => {
    const d = deps({ fetch: vi.fn(async () => { throw new Error("offline"); }) });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toContain("offline");
  });

  it("still writes the file when the header will not parse", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: new ArrayBuffer(64) })),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(d.write).toHaveBeenCalledOnce();
    expect(out.width).toBeUndefined();
    expect(out.failed).toBeUndefined();
  });
});

describe("archiveAll", () => {
  it("processes every item", async () => {
    const list: CanonicalMedia[] = Array.from({ length: 9 }, (_, i) => ({
      key: `https://x.com/${i}.jpg`, url: `https://x.com/${i}.jpg`, kind: "image", alt: "",
    }));
    const out = await archiveAll(list, "https://ref", deps(), 4);
    expect(out).toHaveLength(9);
    expect(out.every((o) => o.file)).toBe(true);
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const d = deps({
      fetch: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { status: 200, arrayBuffer: pngBuffer(10, 10) };
      }),
    });
    const list: CanonicalMedia[] = Array.from({ length: 12 }, (_, i) => ({
      key: `https://x.com/${i}.jpg`, url: `https://x.com/${i}.jpg`, kind: "image", alt: "",
    }));
    await archiveAll(list, "https://ref", d, 4);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/archive.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/archive.ts`**

```ts
import { readDimensions } from "./dimensions";
import { hashUrl } from "./hash";
import type { CanonicalMedia } from "./normalize";

export interface FetchResult {
  status: number;
  arrayBuffer: ArrayBuffer;
  contentType?: string;
}

export type Fetcher = (
  url: string,
  headers: Record<string, string>
) => Promise<FetchResult>;

export interface ArchiveDeps {
  fetch: Fetcher;
  exists: (path: string) => Promise<boolean>;
  write: (path: string, data: ArrayBuffer) => Promise<void>;
  folder: string;
  maxBytes: number;
}

export interface ArchiveOutcome {
  key: string;
  kind: "image" | "video";
  file?: string;
  width?: number;
  height?: number;
  bytes?: number;
  failed?: string;
}

const RETRYABLE = new Set([401, 403, 429]);
const SAFE_CHARS = /[^a-zA-Z0-9._-]/g;

export function archiveFilename(media: CanonicalMedia): string {
  let base = "";
  try {
    base = decodeURIComponent(new URL(media.url).pathname.split("/").pop() ?? "");
  } catch {
    base = "";
  }
  base = base.replace(SAFE_CHARS, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!base) base = "media";

  if (!/\.[a-z0-9]{2,5}$/i.test(base)) {
    base += media.kind === "video" ? ".mp4" : ".jpg";
  }
  if (base.length > 80) {
    const dot = base.lastIndexOf(".");
    base = base.slice(0, 60) + base.slice(dot);
  }
  return `${hashUrl(media.key)}-${base}`;
}

export async function archiveOne(
  media: CanonicalMedia,
  referer: string,
  deps: ArchiveDeps
): Promise<ArchiveOutcome> {
  const path = `${deps.folder}/${archiveFilename(media)}`;
  const base: ArchiveOutcome = { key: media.key, kind: media.kind };

  if (await deps.exists(path)) return { ...base, file: path };

  let response: FetchResult;
  try {
    response = await deps.fetch(media.url, {});
    if (RETRYABLE.has(response.status) && referer) {
      response = await deps.fetch(media.url, { Referer: referer });
    }
  } catch (error) {
    return { ...base, failed: String(error instanceof Error ? error.message : error) };
  }

  if (response.status < 200 || response.status >= 300) {
    return { ...base, failed: `HTTP ${response.status}` };
  }

  // A clipping can point markdown image syntax at a web page. Trust the
  // server's content type over the markup that referenced it.
  const contentType = response.contentType?.split(";")[0]?.trim().toLowerCase();
  if (contentType && !/^(image|video)\//.test(contentType)) {
    return { ...base, failed: `unexpected content type ${contentType}` };
  }

  const bytes = response.arrayBuffer.byteLength;
  if (bytes === 0) return { ...base, failed: "empty response" };
  if (bytes > deps.maxBytes) {
    return { ...base, failed: `too large (${bytes} bytes)` };
  }

  try {
    await deps.write(path, response.arrayBuffer);
  } catch (error) {
    return { ...base, failed: String(error instanceof Error ? error.message : error) };
  }

  const dimensions = media.kind === "image" ? readDimensions(response.arrayBuffer) : null;
  return {
    ...base,
    file: path,
    bytes,
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

export async function archiveAll(
  list: CanonicalMedia[],
  referer: string,
  deps: ArchiveDeps,
  concurrency = 4
): Promise<ArchiveOutcome[]> {
  const results = new Array<ArchiveOutcome>(list.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await archiveOne(list[index], referer, deps);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, worker);
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/archive.test.ts`
Expected: 17 tests PASS. The 403-then-Referer test is the one that matters most in practice.

- [ ] **Step 5: Commit**

```bash
git add src/archive.ts tests/archive.test.ts
git commit -m "feat: archiver with referer retry, size cap and concurrency control"
```

---

### Task 8: Media cache and the Obsidian-facing archive service

**Files:**
- Create: `src/cache.ts`, `src/archive-service.ts`
- Modify: `src/main.ts`
- Test: `tests/cache.test.ts`

**Interfaces:**
- Consumes: `ArchiveOutcome`, `ClippingIndex`, `dedupeMedia`.
- Produces: `CacheEntry`, `class MediaCache` with `get(key)`, `set(entry)`, `has(key)`, `entries()`, `toJSON()`, `static fromJSON(data)`, `mergeOutcome(outcome)`. And `class ArchiveService` with `archiveRecord(record): Promise<void>`, `archiveAll(): Promise<{ ok: number; failed: number }>`.

- [ ] **Step 1: Write the failing cache tests**

Create `tests/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/cache";

describe("MediaCache", () => {
  it("stores and retrieves entries by key", () => {
    const cache = new MediaCache();
    cache.set({ key: "k", file: "f.jpg", thumb: "f.thumb.webp", kind: "image", width: 10, height: 20, bytes: 100 });
    expect(cache.get("k")?.file).toBe("f.jpg");
    expect(cache.has("k")).toBe(true);
  });

  it("round-trips through JSON", () => {
    const cache = new MediaCache();
    cache.set({ key: "k", file: "f.jpg", thumb: "t.webp", kind: "image", width: 10, height: 20, bytes: 100 });
    const restored = MediaCache.fromJSON(JSON.parse(JSON.stringify(cache.toJSON())));
    expect(restored.get("k")).toEqual(cache.get("k"));
  });

  it("survives malformed JSON by starting empty", () => {
    expect(MediaCache.fromJSON(null).entries()).toHaveLength(0);
    expect(MediaCache.fromJSON({ garbage: true }).entries()).toHaveLength(0);
  });

  it("merges a successful outcome into an entry", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", file: "f.jpg", width: 800, height: 600, bytes: 50 });
    expect(cache.get("k")).toMatchObject({ file: "f.jpg", width: 800, height: 600 });
    expect(cache.get("k")?.failed).toBeUndefined();
  });

  it("records a failure without inventing a file path", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", failed: "HTTP 404" });
    expect(cache.get("k")?.failed).toBe("HTTP 404");
    expect(cache.get("k")?.file).toBe("");
  });

  it("clears a previous failure when a later attempt succeeds", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", failed: "HTTP 403" });
    cache.mergeOutcome({ key: "k", kind: "image", file: "f.jpg", width: 1, height: 1, bytes: 1 });
    expect(cache.get("k")?.failed).toBeUndefined();
  });

  it("defaults dimensions to zero when the header did not parse", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", file: "f.jpg", bytes: 10 });
    expect(cache.get("k")?.width).toBe(0);
    expect(cache.get("k")?.height).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cache.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/cache.ts`**

```ts
import type { ArchiveOutcome } from "./archive";

export interface CacheEntry {
  key: string;
  file: string;
  thumb: string;
  kind: "image" | "video";
  width: number;
  height: number;
  bytes: number;
  failed?: string;
}

export class MediaCache {
  private entriesByKey = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entriesByKey.get(key);
  }

  has(key: string): boolean {
    return this.entriesByKey.has(key);
  }

  set(entry: CacheEntry): void {
    this.entriesByKey.set(entry.key, entry);
  }

  entries(): CacheEntry[] {
    return [...this.entriesByKey.values()];
  }

  mergeOutcome(outcome: ArchiveOutcome): void {
    const previous = this.entriesByKey.get(outcome.key);
    const entry: CacheEntry = {
      key: outcome.key,
      kind: outcome.kind,
      file: outcome.file ?? "",
      thumb: previous?.thumb ?? "",
      width: outcome.width ?? previous?.width ?? 0,
      height: outcome.height ?? previous?.height ?? 0,
      bytes: outcome.bytes ?? previous?.bytes ?? 0,
    };
    if (outcome.failed) entry.failed = outcome.failed;
    this.entriesByKey.set(entry.key, entry);
  }

  setThumb(key: string, thumb: string, width: number, height: number): void {
    const entry = this.entriesByKey.get(key);
    if (!entry) return;
    entry.thumb = thumb;
    if (width > 0) entry.width = width;
    if (height > 0) entry.height = height;
  }

  toJSON(): { version: number; entries: CacheEntry[] } {
    return { version: 1, entries: this.entries() };
  }

  static fromJSON(data: unknown): MediaCache {
    const cache = new MediaCache();
    if (!data || typeof data !== "object") return cache;
    const entries = (data as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return cache;
    for (const raw of entries) {
      if (raw && typeof raw === "object" && typeof (raw as CacheEntry).key === "string") {
        cache.set(raw as CacheEntry);
      }
    }
    return cache;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cache.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Implement `src/archive-service.ts`**

This is the Obsidian-facing shell. It supplies the injected dependencies the archiver expects and persists the cache.

```ts
import { App, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import { ArchiveDeps, archiveAll } from "./archive";
import { MediaCache } from "./cache";
import { ClippingIndex } from "./index-store";
import { dedupeMedia } from "./normalize";
import type { ClippingRecord } from "./scan";
import type { ClippingsGridSettings } from "./settings";

const CACHE_FILE = "cache.json";

export class ArchiveService {
  cache = new MediaCache();
  private running = false;
  private listeners: Array<() => void> = [];

  constructor(
    private app: App,
    private index: ClippingIndex,
    private settings: () => ClippingsGridSettings,
    private cacheDir: string
  ) {}

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private cachePath(): string {
    return normalizePath(`${this.cacheDir}/${CACHE_FILE}`);
  }

  async loadCache(): Promise<void> {
    const path = this.cachePath();
    if (!(await this.app.vault.adapter.exists(path))) return;
    try {
      this.cache = MediaCache.fromJSON(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      this.cache = new MediaCache();
    }
  }

  async saveCache(): Promise<void> {
    await this.app.vault.adapter.write(
      this.cachePath(),
      JSON.stringify(this.cache.toJSON())
    );
  }

  private async ensureFolder(): Promise<void> {
    const folder = normalizePath(this.settings().attachmentFolder);
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }
  }

  private deps(): ArchiveDeps {
    return {
      fetch: async (url, headers) => {
        const response = await requestUrl({
          url,
          method: "GET",
          headers,
          throw: false,
        });
        return {
          status: response.status,
          arrayBuffer: response.arrayBuffer,
          contentType: response.headers?.["content-type"],
        };
      },
      exists: (path) => this.app.vault.adapter.exists(normalizePath(path)),
      write: async (path, data) => {
        await this.app.vault.createBinary(normalizePath(path), data);
      },
      folder: normalizePath(this.settings().attachmentFolder),
      maxBytes: this.settings().maxBytes,
    };
  }

  async archiveRecord(record: ClippingRecord): Promise<void> {
    const canonical = dedupeMedia(record.media).filter(
      (m) => !this.cache.get(m.key)?.file
    );
    if (canonical.length === 0) return;

    await this.ensureFolder();
    const outcomes = await archiveAll(canonical, record.source, this.deps(), 4);
    for (const outcome of outcomes) this.cache.mergeOutcome(outcome);
    await this.saveCache();
    this.emit();
  }

  async archiveEverything(): Promise<{ ok: number; failed: number }> {
    if (this.running) return { ok: 0, failed: 0 };
    this.running = true;
    let ok = 0;
    let failed = 0;
    try {
      for (const record of this.index.records()) {
        await this.archiveRecord(record);
      }
      for (const entry of this.cache.entries()) {
        if (entry.failed) failed++;
        else if (entry.file) ok++;
      }
    } finally {
      this.running = false;
    }
    return { ok, failed };
  }

  async archiveFile(file: TFile): Promise<void> {
    const record = this.index.get(file.path);
    if (record) await this.archiveRecord(record);
  }

  notifyResult(result: { ok: number; failed: number }): void {
    new Notice(`Clippings grid: ${result.ok} media archived, ${result.failed} failed`);
  }
}
```

- [ ] **Step 6: Wire the service into `src/main.ts`**

Add the field `archiver!: ArchiveService;` and in `onload`, after the index is created:

```ts
    this.archiver = new ArchiveService(
      this.app,
      this.index,
      () => this.settings,
      this.manifest.dir ?? ".obsidian/plugins/clippings-grid"
    );
    await this.archiver.loadCache();

    this.addCommand({
      id: "archive-clipping-media",
      name: "Archive all clipping media",
      callback: () => {
        void this.archiver.archiveEverything().then((r) => this.archiver.notifyResult(r));
      },
    });
```

And inside the existing `create` event handler, after `void this.index.handleModify(f)`:

```ts
        if (this.settings.archiveOnCreate) {
          window.setTimeout(() => void this.archiver.archiveFile(f), 2000);
        }
```

The delay lets the Web Clipper finish writing before the scan runs.

- [ ] **Step 7: Verify in the vault**

Reload Obsidian, open the command palette, run "Archive all clipping media".
Expected: a notice reporting archived counts. `Attachments/Clippings/` fills with files named like `a3f91c2e-combolands-7.jpg`, including the Nook `.mp4`. Confirm the Combolands duplicates produced 4 files rather than 12, that the Ghost in the Shell clipping's YouTube page URL was rejected on content type rather than saved as a `.jpg`, and that `.obsidian/plugins/clippings-grid/cache.json` exists with width and height on each image entry.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: media cache and archive service wired to a command"
```

---

### Task 9: Thumbnails and video posters

**Files:**
- Create: `src/derive.ts`
- Modify: `src/archive-service.ts`
- Test: `tests/derive.test.ts`

**Interfaces:**
- Consumes: `CacheEntry`.
- Produces: `thumbPath(originalPath: string): string`, `posterPath(originalPath: string): string`, `scaledSize(width, height, targetWidth): { width: number; height: number }`, `renderThumbnail(blobUrl, targetWidth): Promise<{ data: ArrayBuffer; width: number; height: number } | null>`, `renderPoster(blobUrl, targetWidth): Promise<{ data: ArrayBuffer; width: number; height: number } | null>`.

- [ ] **Step 1: Write the failing tests for the pure parts**

Create `tests/derive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { posterPath, scaledSize, thumbPath } from "../src/derive";

describe("thumbPath", () => {
  it("appends a thumb suffix before the extension", () => {
    expect(thumbPath("Attachments/Clippings/abc-a.jpg")).toBe(
      "Attachments/Clippings/abc-a.thumb.webp"
    );
  });

  it("handles files with no extension", () => {
    expect(thumbPath("Attachments/Clippings/abc")).toBe(
      "Attachments/Clippings/abc.thumb.webp"
    );
  });
});

describe("posterPath", () => {
  it("appends a poster suffix before the extension", () => {
    expect(posterPath("Attachments/Clippings/abc-clip.mp4")).toBe(
      "Attachments/Clippings/abc-clip.poster.webp"
    );
  });
});

describe("scaledSize", () => {
  it("scales down to the target width and preserves the ratio", () => {
    expect(scaledSize(1920, 1080, 400)).toEqual({ width: 400, height: 225 });
  });

  it("never upscales", () => {
    expect(scaledSize(200, 100, 400)).toEqual({ width: 200, height: 100 });
  });

  it("guards against zero dimensions", () => {
    expect(scaledSize(0, 0, 400)).toEqual({ width: 400, height: 400 });
  });

  it("rounds to whole pixels", () => {
    const size = scaledSize(1000, 333, 400);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/derive.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/derive.ts`**

The canvas-based functions run only in Obsidian's renderer, so they stay untested by Vitest. The path and sizing math is pure and is what the tests cover.

```ts
export function thumbPath(originalPath: string): string {
  return replaceExtension(originalPath, ".thumb.webp");
}

export function posterPath(originalPath: string): string {
  return replaceExtension(originalPath, ".poster.webp");
}

function replaceExtension(path: string, suffix: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(0, dot) + suffix : path + suffix;
}

export function scaledSize(
  width: number,
  height: number,
  targetWidth: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: targetWidth, height: targetWidth };
  if (width <= targetWidth) return { width, height };
  return {
    width: targetWidth,
    height: Math.round((height / width) * targetWidth),
  };
}

async function encode(
  canvas: HTMLCanvasElement
): Promise<ArrayBuffer | null> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.8)
  );
  return blob ? await blob.arrayBuffer() : null;
}

export async function renderThumbnail(
  sourceUrl: string,
  targetWidth: number
): Promise<{ data: ArrayBuffer; width: number; height: number } | null> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = sourceUrl;
  if (!(await loaded)) return null;

  const size = scaledSize(image.naturalWidth, image.naturalHeight, targetWidth);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, size.width, size.height);

  const data = await encode(canvas);
  if (!data) return null;
  return { data, width: image.naturalWidth, height: image.naturalHeight };
}

export async function renderPoster(
  sourceUrl: string,
  targetWidth: number
): Promise<{ data: ArrayBuffer; width: number; height: number } | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.src = sourceUrl;

  const ready = new Promise<boolean>((resolve) => {
    video.onloadeddata = () => resolve(true);
    video.onerror = () => resolve(false);
    window.setTimeout(() => resolve(false), 10000);
  });
  if (!(await ready)) return null;

  const seeked = new Promise<boolean>((resolve) => {
    video.onseeked = () => resolve(true);
    video.onerror = () => resolve(false);
    window.setTimeout(() => resolve(false), 5000);
  });
  video.currentTime = Math.min(0.1, video.duration || 0.1);
  if (!(await seeked)) return null;

  const size = scaledSize(video.videoWidth, video.videoHeight, targetWidth);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, size.width, size.height);

  const data = await encode(canvas);
  if (!data) return null;
  return { data, width: video.videoWidth, height: video.videoHeight };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/derive.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Generate derived assets in `src/archive-service.ts`**

Add the imports and a method, then call it at the end of `archiveRecord` before `saveCache`:

```ts
import { posterPath, renderPoster, renderThumbnail, thumbPath } from "./derive";
```

```ts
  private resourceUrl(path: string): string | null {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }

  async deriveAssets(): Promise<void> {
    const width = this.settings().thumbnailWidth;
    for (const entry of this.cache.entries()) {
      if (!entry.file || entry.thumb) continue;
      const source = this.resourceUrl(entry.file);
      if (!source) continue;

      const target = entry.kind === "video" ? posterPath(entry.file) : thumbPath(entry.file);
      const rendered =
        entry.kind === "video"
          ? await renderPoster(source, width)
          : await renderThumbnail(source, width);

      if (!rendered) continue;
      if (!(await this.app.vault.adapter.exists(normalizePath(target)))) {
        await this.app.vault.createBinary(normalizePath(target), rendered.data);
      }
      this.cache.setThumb(entry.key, target, rendered.width, rendered.height);
    }
  }
```

Then in `archiveRecord`, replace `await this.saveCache();` with:

```ts
    await this.deriveAssets();
    await this.saveCache();
```

- [ ] **Step 6: Verify in the vault**

Delete `cache.json` and the contents of `Attachments/Clippings/`, reload Obsidian, run "Archive all clipping media" again.
Expected: each original now has a `.thumb.webp` sibling, the Nook mp4 has a `.poster.webp`, and every `cache.json` entry has a non-empty `thumb` plus real `width` and `height`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: generate webp thumbnails and video posters at archive time"
```

---

### Task 10: The grid

The second vault milestone, and the one that looks like the screenshots.

**Files:**
- Create: `src/tile.ts`, `src/grid.ts`
- Modify: `src/view.ts`, `styles.css`
- Test: `tests/tile.test.ts`

**Interfaces:**
- Consumes: `ClippingRecord`, `MediaCache`, `computeLayout`, `columnsForWidth`, `visibleRange`, `dedupeMedia`.
- Produces: `TileModel { id: string; record: ClippingRecord; thumbPath: string; filePath: string; kind: "image" | "video" | "fallback"; width: number; height: number; gradient: string }`, `buildTiles(records, cache): TileModel[]`, `gradientFor(seed: string): string`, `class GridRenderer`.

- [ ] **Step 1: Write the failing tests**

Create `tests/tile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTiles, gradientFor } from "../src/tile";
import { MediaCache } from "../src/cache";
import { scanClipping } from "../src/scan";
import {
  COMBOLANDS_BODY, COMBOLANDS_FM,
  NOOK_BODY, NOOK_FM,
} from "./fixtures/clippings";

function cacheWith(entries: Array<[string, Partial<{ file: string; thumb: string; kind: "image" | "video"; width: number; height: number }>]>): MediaCache {
  const cache = new MediaCache();
  for (const [key, e] of entries) {
    cache.set({
      key, file: e.file ?? "f", thumb: e.thumb ?? "t", kind: e.kind ?? "image",
      width: e.width ?? 100, height: e.height ?? 100, bytes: 1,
    });
  }
  return cache;
}

describe("gradientFor", () => {
  it("is stable for the same seed", () => {
    expect(gradientFor("polygon.com")).toBe(gradientFor("polygon.com"));
  });

  it("differs across seeds", () => {
    expect(gradientFor("polygon.com")).not.toBe(gradientFor("github.com"));
  });

  it("produces a css gradient", () => {
    expect(gradientFor("x")).toMatch(/^linear-gradient\(/);
  });
});

describe("buildTiles", () => {
  const combolands = scanClipping("Clippings/C.md", COMBOLANDS_FM, COMBOLANDS_BODY);
  const nook = scanClipping("Clippings/N.md", NOOK_FM, NOOK_BODY);

  it("uses the first archived image as the cover", () => {
    const cache = cacheWith([
      ["https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-7.jpg",
        { thumb: "T7.webp", file: "F7.jpg", width: 1920, height: 1080 }],
    ]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].thumbPath).toBe("T7.webp");
    expect(tiles[0].kind).toBe("image");
    expect(tiles[0].width).toBe(1920);
  });

  it("skips to the next media ref when the first failed to archive", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-7.jpg", kind: "image", failed: "HTTP 404" });
    cache.set({
      key: "https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-6.jpg",
      file: "F6.jpg", thumb: "T6.webp", kind: "image", width: 800, height: 600, bytes: 1,
    });
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].thumbPath).toBe("T6.webp");
  });

  it("uses the video for a video-only clipping", () => {
    const cache = cacheWith([
      ["https://cdn.spottedinprod.com/community-clips/19305/797/1786251277681-transcoded.mp4",
        { kind: "video", file: "clip.mp4", thumb: "clip.poster.webp", width: 886, height: 1920 }],
    ]);
    const tiles = buildTiles([nook], cache);
    expect(tiles[0].kind).toBe("video");
    expect(tiles[0].filePath).toBe("clip.mp4");
    expect(tiles[0].thumbPath).toBe("clip.poster.webp");
  });

  it("falls back to a gradient tile when nothing archived", () => {
    const tiles = buildTiles([combolands], new MediaCache());
    expect(tiles[0].kind).toBe("fallback");
    expect(tiles[0].thumbPath).toBe("");
    expect(tiles[0].gradient).toMatch(/^linear-gradient\(/);
  });

  it("gives fallback tiles a sane default aspect ratio", () => {
    const tiles = buildTiles([combolands], new MediaCache());
    expect(tiles[0].width).toBe(4);
    expect(tiles[0].height).toBe(3);
  });

  it("honors an explicit cover in frontmatter", () => {
    const record = scanClipping(
      "Clippings/C.md",
      { ...COMBOLANDS_FM, cover: "Attachments/Clippings/manual.png" },
      COMBOLANDS_BODY
    );
    const tiles = buildTiles([record], new MediaCache());
    expect(tiles[0].thumbPath).toBe("Attachments/Clippings/manual.png");
  });

  it("uses the note path as the tile id", () => {
    const tiles = buildTiles([combolands], new MediaCache());
    expect(tiles[0].id).toBe("Clippings/C.md");
  });

  it("falls back to zero dimensions gracefully when the cache has none", () => {
    const cache = cacheWith([
      ["https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-7.jpg",
        { thumb: "T.webp", width: 0, height: 0 }],
    ]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].width).toBe(4);
    expect(tiles[0].height).toBe(3);
  });
});
```

Note: `scanClipping` must pass an unknown `cover` frontmatter key through. Add `cover: string` to `ClippingRecord` in `src/scan.ts` and populate it with `str(frontmatter.cover)`, then add it to the returned object.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tile.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Add `cover` to `src/scan.ts` and fix the older test factory**

In the `ClippingRecord` interface add `cover: string;`, and in the return object add `cover: str(frontmatter.cover),`.

This widens the type, so the record factory written back in Task 4 no longer compiles under `tsc --noEmit`. In `tests/index-store.test.ts`, add `cover: ""` to the object returned by `rec`:

```ts
function rec(path: string, created: string, title: string): ClippingRecord {
  return {
    path, created, title,
    source: "", description: "", categories: [], status: "unread",
    media: [], cover: "", haystack: title.toLowerCase(),
  };
}
```

Run `npx tsc --noEmit` and confirm it is clean before moving on.

- [ ] **Step 4: Implement `src/tile.ts`**

```ts
import type { MediaCache } from "./cache";
import { hashUrl } from "./hash";
import { dedupeMedia } from "./normalize";
import type { ClippingRecord } from "./scan";

export interface TileModel {
  id: string;
  record: ClippingRecord;
  thumbPath: string;
  filePath: string;
  kind: "image" | "video" | "fallback";
  width: number;
  height: number;
  gradient: string;
}

export function gradientFor(seed: string): string {
  const hash = hashUrl(seed);
  const hue = parseInt(hash.slice(0, 4), 16) % 360;
  const second = (hue + 40) % 360;
  return `linear-gradient(140deg, hsl(${hue} 45% 28%), hsl(${second} 50% 16%))`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function buildTiles(records: ClippingRecord[], cache: MediaCache): TileModel[] {
  return records.map((record) => {
    const gradient = gradientFor(domainOf(record.source) || record.title);
    const base = { id: record.path, record, gradient };

    if (record.cover) {
      return { ...base, thumbPath: record.cover, filePath: record.cover, kind: "image" as const, width: 4, height: 3 };
    }

    for (const media of dedupeMedia(record.media)) {
      const entry = cache.get(media.key);
      if (!entry || entry.failed || !entry.file || !entry.thumb) continue;
      const hasSize = entry.width > 0 && entry.height > 0;
      return {
        ...base,
        thumbPath: entry.thumb,
        filePath: entry.file,
        kind: entry.kind,
        width: hasSize ? entry.width : 4,
        height: hasSize ? entry.height : 3,
      };
    }

    return { ...base, thumbPath: "", filePath: "", kind: "fallback" as const, width: 4, height: 3 };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tile.test.ts`
Expected: 11 tests PASS.

- [ ] **Step 6: Implement `src/grid.ts` with virtualization and a recycled tile pool**

```ts
import { App, TFile, normalizePath } from "obsidian";
import { columnsForWidth, computeLayout, visibleRange } from "./layout";
import type { LayoutResult, Position } from "./layout";
import type { TileModel } from "./tile";

const GAP = 14;
const TARGET_COLUMN_WIDTH = 300;
const OVERSCAN = 600;

interface TileElement {
  root: HTMLElement;
  media: HTMLElement | null;
  id: string;
}

export class GridRenderer {
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private tiles: TileModel[] = [];
  private byId = new Map<string, TileModel>();
  private layout: LayoutResult = { positions: [], totalHeight: 0 };
  private mounted = new Map<string, TileElement>();
  private pool: TileElement[] = [];
  private frame = 0;

  constructor(private app: App, private container: HTMLElement) {
    this.scroller = container.createDiv({ cls: "cg-scroller" });
    this.spacer = this.scroller.createDiv({ cls: "cg-spacer" });
    this.scroller.addEventListener("scroll", () => this.schedule(), { passive: true });
  }

  get scrollerEl(): HTMLElement {
    return this.scroller;
  }

  setTiles(tiles: TileModel[]): void {
    this.tiles = tiles;
    this.byId = new Map(tiles.map((t) => [t.id, t]));
    this.relayout();
  }

  relayout(): void {
    const width = this.scroller.clientWidth || 800;
    const columns = columnsForWidth(width, TARGET_COLUMN_WIDTH, GAP);
    this.layout = computeLayout(
      this.tiles.map((t) => ({ id: t.id, width: t.width, height: t.height })),
      width,
      columns,
      GAP
    );
    this.spacer.style.height = `${this.layout.totalHeight}px`;
    this.render();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private acquire(): TileElement {
    const recycled = this.pool.pop();
    if (recycled) return recycled;
    const root = this.spacer.createDiv({ cls: "cg-tile" });
    return { root, media: null, id: "" };
  }

  private release(tile: TileElement): void {
    tile.root.style.display = "none";
    tile.id = "";
    tile.root.empty();
    tile.media = null;
    this.pool.push(tile);
  }

  private resourceFor(path: string): string {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
  }

  private paint(element: TileElement, model: TileModel, position: Position): void {
    element.root.style.display = "";
    element.root.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    element.root.style.width = `${position.w}px`;
    element.root.style.height = `${position.h}px`;

    if (element.id === model.id) return;
    element.id = model.id;
    element.root.empty();

    const frame = element.root.createDiv({ cls: "cg-frame" });

    if (model.kind === "fallback") {
      frame.style.background = model.gradient;
      frame.createDiv({ cls: "cg-fallback-title", text: model.record.title });
    } else if (model.kind === "video") {
      const poster = this.resourceFor(model.thumbPath);
      const video = frame.createEl("video", { cls: "cg-media" });
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "none";
      if (poster) video.poster = poster;
      video.dataset.src = this.resourceFor(model.filePath);
      element.media = video;
    } else {
      const image = frame.createEl("img", { cls: "cg-media" });
      image.loading = "lazy";
      image.decoding = "async";
      image.width = model.width;
      image.height = model.height;
      image.alt = model.record.title;
      image.src = this.resourceFor(model.thumbPath) || this.resourceFor(model.filePath);
      element.media = image;
    }

    const meta = element.root.createDiv({ cls: "cg-meta" });
    meta.createDiv({ cls: "cg-title", text: model.record.title });
    const sub = meta.createDiv({ cls: "cg-sub" });
    sub.createSpan({ text: domainOf(model.record.source) });
    if (model.record.categories.length) {
      sub.createSpan({ cls: "cg-dot", text: "·" });
      sub.createSpan({ text: model.record.categories.join(", ") });
    }
    if (model.record.status === "unread") {
      element.root.createDiv({ cls: "cg-unread" });
    }

    element.root.onclick = (event: MouseEvent) => {
      const file = this.app.vault.getAbstractFileByPath(model.record.path);
      if (!(file instanceof TFile)) return;
      const newPane = event.metaKey || event.ctrlKey;
      void this.app.workspace.getLeaf(newPane ? "tab" : false).openFile(file);
    };
  }

  render(): void {
    const scrollTop = this.scroller.scrollTop;
    const height = this.scroller.clientHeight;
    const visible = visibleRange(this.layout.positions, scrollTop, height, OVERSCAN);
    const wanted = new Set(visible.map((p) => p.id));

    for (const [id, element] of [...this.mounted]) {
      if (!wanted.has(id)) {
        this.mounted.delete(id);
        this.release(element);
      }
    }

    for (const position of visible) {
      const model = this.byId.get(position.id);
      if (!model) continue;
      let element = this.mounted.get(position.id);
      if (!element) {
        element = this.acquire();
        this.mounted.set(position.id, element);
      }
      this.paint(element, model, position);
    }

    this.onRendered();
  }

  onRendered: () => void = () => {};

  mountedMedia(): HTMLElement[] {
    return [...this.mounted.values()].map((t) => t.media).filter((m): m is HTMLElement => !!m);
  }

  destroy(): void {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.mounted.clear();
    this.pool = [];
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
```

- [ ] **Step 7: Replace the list in `src/view.ts` with the grid**

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import { GridRenderer } from "./grid";
import type ClippingsGridPlugin from "./main";
import { buildTiles } from "./tile";

export const VIEW_TYPE_GRID = "clippings-grid";

export class ClippingsGridView extends ItemView {
  private grid: GridRenderer | null = null;
  private observer: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: ClippingsGridPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_GRID; }
  getDisplayText(): string { return "Clippings grid"; }
  getIcon(): string { return "layout-grid"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("clippings-grid-view");
    this.grid = new GridRenderer(this.app, this.contentEl);

    this.plugin.index.onChange(() => this.refresh());
    this.plugin.archiver.onChange(() => this.refresh());

    this.observer = new ResizeObserver(() => this.grid?.relayout());
    this.observer.observe(this.contentEl);

    this.refresh();
  }

  async onClose(): Promise<void> {
    this.observer?.disconnect();
    this.grid?.destroy();
  }

  refresh(): void {
    if (!this.grid) return;
    const tiles = buildTiles(this.plugin.index.records(), this.plugin.archiver.cache);
    this.grid.setTiles(tiles);
  }
}
```

- [ ] **Step 8: Write `styles.css`**

```css
.clippings-grid-view {
  height: 100%;
  padding: 0;
  overflow: hidden;
  background: var(--background-primary);
}

.cg-scroller {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  contain: strict;
}

.cg-spacer {
  position: relative;
  width: 100%;
}

.cg-tile {
  position: absolute;
  top: 0;
  left: 0;
  contain: layout paint size;
  cursor: pointer;
  border-radius: 10px;
  overflow: hidden;
  background: var(--background-secondary);
}

.cg-frame {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cg-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cg-fallback-title {
  padding: 16px;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  text-align: center;
  line-height: 1.3;
}

.cg-meta {
  position: absolute;
  inset: auto 0 0 0;
  padding: 28px 12px 10px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.82));
  color: #fff;
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}

.cg-tile:hover .cg-meta {
  opacity: 1;
}

.cg-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cg-sub {
  margin-top: 3px;
  font-size: 11px;
  opacity: 0.75;
  display: flex;
  gap: 5px;
}

.cg-unread {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
}
```

- [ ] **Step 9: Verify in the vault**

Reload Obsidian and open the grid.
Expected: a masonry wall. Combolands shows the snowy city, manga-downloader shows `prompt.gif`, Nook shows its video poster. Hovering reveals title, domain, and categories. Clicking opens the note; Cmd-click opens it in a new tab. Resizing the pane recolumns without jumping.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: virtualized masonry grid with recycled tiles"
```

---

### Task 11: Video autoplay, optimized

**Files:**
- Create: `src/playback.ts`
- Modify: `src/grid.ts`, `src/view.ts`
- Test: `tests/playback.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `choosePlaying(candidates: Array<{ id: string; centerDistance: number; ratio: number }>, max: number): string[]`, `class PlaybackController` with `observe(el: HTMLVideoElement)`, `unobserve(el)`, `setEnabled(on: boolean)`, `destroy()`.

- [ ] **Step 1: Write the failing tests for the pure selection rule**

Create `tests/playback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { choosePlaying } from "../src/playback";

describe("choosePlaying", () => {
  it("plays nothing when nothing is sufficiently visible", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.2 }], 4)).toEqual([]);
  });

  it("plays candidates that are at least half visible", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.6 }], 4)).toEqual(["a"]);
  });

  it("caps the number playing", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `i${i}`, centerDistance: i, ratio: 0.9,
    }));
    expect(choosePlaying(candidates, 4)).toHaveLength(4);
  });

  it("prefers the candidates nearest the viewport center", () => {
    const chosen = choosePlaying([
      { id: "far", centerDistance: 900, ratio: 0.9 },
      { id: "near", centerDistance: 20, ratio: 0.9 },
      { id: "mid", centerDistance: 300, ratio: 0.9 },
    ], 2);
    expect(chosen).toEqual(["near", "mid"]);
  });

  it("returns an empty list for no candidates", () => {
    expect(choosePlaying([], 4)).toEqual([]);
  });

  it("plays nothing when the cap is zero", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 1, ratio: 1 }], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/playback.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/playback.ts`**

```ts
const MIN_RATIO = 0.5;

export interface PlaybackCandidate {
  id: string;
  centerDistance: number;
  ratio: number;
}

export function choosePlaying(candidates: PlaybackCandidate[], max: number): string[] {
  return candidates
    .filter((c) => c.ratio >= MIN_RATIO)
    .sort((a, b) => a.centerDistance - b.centerDistance)
    .slice(0, Math.max(0, max))
    .map((c) => c.id);
}

export class PlaybackController {
  private observer: IntersectionObserver | null = null;
  private ratios = new Map<HTMLVideoElement, number>();
  private enabled: boolean;
  private frame = 0;

  constructor(
    private root: HTMLElement,
    enabled: boolean,
    private maxConcurrent = 4
  ) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.enabled = enabled && !reduced;

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          this.ratios.set(video, entry.intersectionRatio);
          if (entry.intersectionRatio > 0 && video.preload === "none") {
            video.preload = "metadata";
            const src = video.dataset.src;
            if (src && !video.src) video.src = src;
          }
        }
        this.schedule();
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.pauseAll();
    else this.schedule();
  };

  setEnabled(on: boolean): void {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.enabled = on && !reduced;
    if (!this.enabled) this.pauseAll();
    else this.schedule();
  }

  observe(video: HTMLVideoElement): void {
    this.observer?.observe(video);
  }

  unobserve(video: HTMLVideoElement): void {
    this.observer?.unobserve(video);
    this.ratios.delete(video);
    video.pause();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
    });
  }

  private pauseAll(): void {
    for (const video of this.ratios.keys()) video.pause();
  }

  private apply(): void {
    if (!this.enabled) return;
    const rootRect = this.root.getBoundingClientRect();
    const rootCenter = rootRect.top + rootRect.height / 2;

    const videos = [...this.ratios.keys()];
    const candidates = videos.map((video, index) => {
      const rect = video.getBoundingClientRect();
      return {
        id: String(index),
        centerDistance: Math.abs(rect.top + rect.height / 2 - rootCenter),
        ratio: this.ratios.get(video) ?? 0,
      };
    });

    const playing = new Set(choosePlaying(candidates, this.maxConcurrent));
    videos.forEach((video, index) => {
      if (playing.has(String(index))) {
        if (video.paused) void video.play().catch(() => undefined);
      } else if (!video.paused) {
        video.pause();
      }
    });
  }

  destroy(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    this.ratios.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/playback.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Connect playback in `src/view.ts`**

After creating the grid:

```ts
import { PlaybackController } from "./playback";
```

```ts
    this.playback = new PlaybackController(
      this.grid.scrollerEl,
      this.plugin.settings.autoplayVideo
    );
    this.grid.onRendered = () => {
      for (const media of this.grid?.mountedMedia() ?? []) {
        if (media instanceof HTMLVideoElement) this.playback?.observe(media);
      }
    };
```

Declare `private playback: PlaybackController | null = null;` and call `this.playback?.destroy();` in `onClose`.

- [ ] **Step 6: Verify in the vault**

Reload Obsidian, open the grid.
Expected: the Nook tile plays silently and loops on its own. Scrolling it out of view pauses it. Switching to another app or tab pauses it. Turning on macOS Reduce Motion and reloading leaves it on its poster frame.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: viewport-driven video autoplay with a concurrency cap"
```

---

### Task 12: Filter bar and search

**Files:**
- Create: `src/filter.ts`, `src/toolbar.ts`
- Modify: `src/view.ts`, `styles.css`
- Test: `tests/filter.test.ts`

**Interfaces:**
- Consumes: `ClippingRecord`.
- Produces: `FilterState { categories: Set<string>; statuses: Set<string>; query: string }`, `emptyFilter(): FilterState`, `applyFilter(records, state): ClippingRecord[]`, `collectCategories(records): Array<{ name: string; count: number }>`, `class Toolbar`.

- [ ] **Step 1: Write the failing tests**

Create `tests/filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyFilter, collectCategories, emptyFilter } from "../src/filter";
import type { ClippingRecord } from "../src/scan";

function rec(title: string, categories: string[], status: string): ClippingRecord {
  return {
    path: `${title}.md`, title, source: "https://www.polygon.com/x",
    description: "", categories, status, created: "2026-01-01",
    media: [], cover: "",
    haystack: [title, "polygon.com", ...categories, status].join(" ").toLowerCase(),
  };
}

const records = [
  rec("Combolands", ["games", "indie"], "unread"),
  rec("Manga downloader", ["tools", "cli"], "read"),
  rec("Nook", ["design", "ios"], "unread"),
];

describe("applyFilter", () => {
  it("returns everything for an empty filter", () => {
    expect(applyFilter(records, emptyFilter())).toHaveLength(3);
  });

  it("filters by a single category", () => {
    const state = { ...emptyFilter(), categories: new Set(["games"]) };
    expect(applyFilter(records, state).map((r) => r.title)).toEqual(["Combolands"]);
  });

  it("treats multiple categories as a union", () => {
    const state = { ...emptyFilter(), categories: new Set(["games", "design"]) };
    expect(applyFilter(records, state)).toHaveLength(2);
  });

  it("filters by status", () => {
    const state = { ...emptyFilter(), statuses: new Set(["unread"]) };
    expect(applyFilter(records, state)).toHaveLength(2);
  });

  it("intersects category and status", () => {
    const state = {
      ...emptyFilter(),
      categories: new Set(["games", "design"]),
      statuses: new Set(["unread"]),
    };
    expect(applyFilter(records, state)).toHaveLength(2);
  });

  it("searches the haystack case-insensitively", () => {
    const state = { ...emptyFilter(), query: "NOOK" };
    expect(applyFilter(records, state).map((r) => r.title)).toEqual(["Nook"]);
  });

  it("searches by source domain", () => {
    const state = { ...emptyFilter(), query: "polygon" };
    expect(applyFilter(records, state)).toHaveLength(3);
  });

  it("requires every whitespace-separated term to match", () => {
    const state = { ...emptyFilter(), query: "nook design" };
    expect(applyFilter(records, state)).toHaveLength(1);
    const miss = { ...emptyFilter(), query: "nook games" };
    expect(applyFilter(records, miss)).toHaveLength(0);
  });

  it("ignores surrounding whitespace in the query", () => {
    const state = { ...emptyFilter(), query: "   nook   " };
    expect(applyFilter(records, state)).toHaveLength(1);
  });
});

describe("collectCategories", () => {
  it("counts each category across records", () => {
    const counts = collectCategories(records);
    expect(counts.find((c) => c.name === "games")?.count).toBe(1);
    expect(counts).toHaveLength(6);
  });

  it("sorts by count descending then alphabetically", () => {
    const counts = collectCategories([...records, rec("Extra", ["games"], "unread")]);
    expect(counts[0].name).toBe("games");
    expect(counts[0].count).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/filter.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/filter.ts`**

```ts
import type { ClippingRecord } from "./scan";

export interface FilterState {
  categories: Set<string>;
  statuses: Set<string>;
  query: string;
}

export function emptyFilter(): FilterState {
  return { categories: new Set(), statuses: new Set(), query: "" };
}

export function applyFilter(
  records: ClippingRecord[],
  state: FilterState
): ClippingRecord[] {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);

  return records.filter((record) => {
    if (state.categories.size > 0) {
      if (!record.categories.some((c) => state.categories.has(c))) return false;
    }
    if (state.statuses.size > 0 && !state.statuses.has(record.status)) return false;
    return terms.every((term) => record.haystack.includes(term));
  });
}

export function collectCategories(
  records: ClippingRecord[]
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const category of record.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/filter.test.ts`
Expected: 11 tests PASS.

- [ ] **Step 5: Implement `src/toolbar.ts`**

```ts
import { collectCategories, emptyFilter } from "./filter";
import type { FilterState } from "./filter";
import type { ClippingRecord } from "./scan";

const STATUSES = ["unread", "read", "archived"];

export class Toolbar {
  state: FilterState = emptyFilter();
  private chips: HTMLElement;
  private debounce = 0;

  constructor(container: HTMLElement, private onChange: () => void) {
    const bar = container.createDiv({ cls: "cg-toolbar" });

    const search = bar.createEl("input", { cls: "cg-search", type: "search" });
    search.placeholder = "Search clippings";
    search.addEventListener("input", () => {
      window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => {
        this.state.query = search.value;
        this.onChange();
      }, 120);
    });

    this.chips = bar.createDiv({ cls: "cg-chips" });
  }

  refresh(records: ClippingRecord[]): void {
    this.chips.empty();

    for (const status of STATUSES) {
      this.chip(this.chips, status, this.state.statuses, "cg-chip-status");
    }
    this.chips.createDiv({ cls: "cg-chip-divider" });
    for (const { name, count } of collectCategories(records)) {
      this.chip(this.chips, name, this.state.categories, "cg-chip-category", count);
    }
  }

  private chip(
    parent: HTMLElement,
    label: string,
    set: Set<string>,
    cls: string,
    count?: number
  ): void {
    const chip = parent.createDiv({ cls: `cg-chip ${cls}` });
    chip.setText(count === undefined ? label : `${label} ${count}`);
    if (set.has(label)) chip.addClass("is-active");
    chip.onclick = () => {
      if (set.has(label)) set.delete(label);
      else set.add(label);
      this.onChange();
    };
  }
}
```

- [ ] **Step 6: Wire the toolbar into `src/view.ts`**

Build the toolbar before the grid so it sits above it, and filter in `refresh`:

```ts
import { applyFilter } from "./filter";
import { Toolbar } from "./toolbar";
```

```ts
    this.toolbar = new Toolbar(this.contentEl, () => this.refresh());
    this.grid = new GridRenderer(this.app, this.contentEl);
```

```ts
  refresh(): void {
    if (!this.grid || !this.toolbar) return;
    const all = this.plugin.index.records();
    this.toolbar.refresh(all);
    const visible = applyFilter(all, this.toolbar.state);
    this.grid.setTiles(buildTiles(visible, this.plugin.archiver.cache));
  }
```

Declare `private toolbar: Toolbar | null = null;`.

- [ ] **Step 7: Add toolbar styles to `styles.css`**

```css
.clippings-grid-view {
  display: flex;
  flex-direction: column;
}

.cg-toolbar {
  flex: 0 0 auto;
  padding: 12px 16px 8px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.cg-search {
  width: 100%;
  margin-bottom: 8px;
}

.cg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.cg-chip {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--background-modifier-hover);
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.cg-chip:hover {
  color: var(--text-normal);
}

.cg-chip.is-active {
  background: var(--color-accent);
  color: var(--text-on-accent);
}

.cg-chip-divider {
  width: 1px;
  height: 16px;
  background: var(--background-modifier-border);
  margin: 0 4px;
}

.cg-scroller {
  flex: 1 1 auto;
}
```

- [ ] **Step 8: Verify in the vault**

Reload Obsidian and open the grid.
Expected: chips for `unread` / `read` / `archived`, then category chips with counts (`games 1`, `tools 1`, `design 1`, and so on). Clicking `games` leaves only Combolands. Typing "nook" in search leaves only Nook. Clearing both restores all three.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: category and status filters plus debounced search"
```

---

### Task 13: Render repair for dead image links

**Files:**
- Create: `src/repair.ts`
- Modify: `src/main.ts`
- Test: `tests/repair.test.ts`

**Interfaces:**
- Consumes: `normalizeUrl`, `MediaCache`.
- Produces: `localReplacement(src: string, cache: MediaCache): string | null`, `installRepair(plugin): void`.

- [ ] **Step 1: Write the failing tests**

Create `tests/repair.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/cache";
import { localReplacement } from "../src/repair";

function cache(): MediaCache {
  const c = new MediaCache();
  c.set({
    key: "https://x.com/a.jpg", file: "Attachments/Clippings/abc-a.jpg",
    thumb: "Attachments/Clippings/abc-a.thumb.webp", kind: "image",
    width: 100, height: 100, bytes: 1,
  });
  return c;
}

describe("localReplacement", () => {
  it("finds the archived original for an exact url", () => {
    expect(localReplacement("https://x.com/a.jpg", cache()))
      .toBe("Attachments/Clippings/abc-a.jpg");
  });

  it("finds it for a size variant of the same url", () => {
    expect(localReplacement("https://x.com/a.jpg?w=750&h=422&dpr=2", cache()))
      .toBe("Attachments/Clippings/abc-a.jpg");
  });

  it("returns the original, not the thumbnail", () => {
    expect(localReplacement("https://x.com/a.jpg", cache())).not.toContain("thumb");
  });

  it("returns null for an unknown url", () => {
    expect(localReplacement("https://x.com/other.jpg", cache())).toBeNull();
  });

  it("returns null when the cache entry recorded a failure", () => {
    const c = new MediaCache();
    c.mergeOutcome({ key: "https://x.com/a.jpg", kind: "image", failed: "HTTP 404" });
    expect(localReplacement("https://x.com/a.jpg", c)).toBeNull();
  });

  it("returns null for a non-http src", () => {
    expect(localReplacement("app://local/whatever.jpg", cache())).toBeNull();
  });

  it("returns null for an empty src", () => {
    expect(localReplacement("", cache())).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/repair.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/repair.ts`**

```ts
import { MarkdownPostProcessorContext, TFile, normalizePath } from "obsidian";
import type { MediaCache } from "./cache";
import { isInFolder } from "./index-store";
import type ClippingsGridPlugin from "./main";
import { normalizeUrl } from "./normalize";

export function localReplacement(src: string, cache: MediaCache): string | null {
  if (!src || !/^https?:\/\//i.test(src)) return null;
  const entry = cache.get(normalizeUrl(src));
  if (!entry || entry.failed || !entry.file) return null;
  return entry.file;
}

export function installRepair(plugin: ClippingsGridPlugin): void {
  plugin.registerMarkdownPostProcessor(
    (element: HTMLElement, context: MarkdownPostProcessorContext) => {
      if (!isInFolder(context.sourcePath, plugin.settings.clippingsFolder)) return;

      const media = [
        ...Array.from(element.querySelectorAll("img")),
        ...Array.from(element.querySelectorAll("video")),
      ];

      for (const node of media) {
        const original = node.getAttribute("src");
        if (!original) continue;
        node.addEventListener(
          "error",
          () => {
            const replacement = localReplacement(original, plugin.archiver.cache);
            if (!replacement) return;
            const file = plugin.app.vault.getAbstractFileByPath(normalizePath(replacement));
            if (file instanceof TFile) {
              node.setAttribute("src", plugin.app.vault.getResourcePath(file));
            }
          },
          { once: true }
        );
      }
    }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/repair.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Install the processor in `src/main.ts`**

```ts
import { installRepair } from "./repair";
```

At the end of `onload`: `installRepair(this);`

- [ ] **Step 6: Verify in the vault**

Open the Combolands clipping in reading view. Then disconnect from the network (or temporarily block the domain) and reopen it.
Expected: images still render, served from `Attachments/Clippings/`. The note file on disk is unchanged: confirm with `git diff` if the vault is tracked, or by checking the file's modification time.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: repair dead clipping images at render time without touching notes"
```

---

### Task 14: Settings tab and orphan cleanup

**Files:**
- Create: `src/settings-tab.ts`, `src/cleanup.ts`
- Modify: `src/main.ts`
- Test: `tests/cleanup.test.ts`

**Interfaces:**
- Consumes: `MediaCache`, `ClippingRecord`, `dedupeMedia`.
- Produces: `findOrphans(archivedFiles: string[], records: ClippingRecord[], cache: MediaCache): string[]`, `class ClippingsGridSettingTab extends PluginSettingTab`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cleanup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/cache";
import { findOrphans } from "../src/cleanup";
import type { ClippingRecord } from "../src/scan";

function record(urls: string[]): ClippingRecord {
  return {
    path: "Clippings/A.md", title: "A", source: "", description: "",
    categories: [], status: "unread", created: "", cover: "", haystack: "",
    media: urls.map((url) => ({ url, kind: "image" as const, alt: "" })),
  };
}

function cache(pairs: Array<[string, string]>): MediaCache {
  const c = new MediaCache();
  for (const [key, file] of pairs) {
    c.set({ key, file, thumb: file + ".thumb.webp", kind: "image", width: 1, height: 1, bytes: 1 });
  }
  return c;
}

describe("findOrphans", () => {
  it("returns nothing when every file is still referenced", () => {
    const orphans = findOrphans(
      ["Attachments/Clippings/a.jpg", "Attachments/Clippings/a.jpg.thumb.webp"],
      [record(["https://x.com/a.jpg"])],
      cache([["https://x.com/a.jpg", "Attachments/Clippings/a.jpg"]])
    );
    expect(orphans).toEqual([]);
  });

  it("flags a file whose clipping is gone", () => {
    const orphans = findOrphans(
      ["Attachments/Clippings/a.jpg", "Attachments/Clippings/gone.jpg"],
      [record(["https://x.com/a.jpg"])],
      cache([
        ["https://x.com/a.jpg", "Attachments/Clippings/a.jpg"],
        ["https://x.com/gone.jpg", "Attachments/Clippings/gone.jpg"],
      ])
    );
    expect(orphans).toEqual(["Attachments/Clippings/gone.jpg"]);
  });

  it("keeps derived thumbnails of files that are still referenced", () => {
    const orphans = findOrphans(
      ["Attachments/Clippings/a.jpg", "Attachments/Clippings/a.thumb.webp"],
      [record(["https://x.com/a.jpg"])],
      cache([["https://x.com/a.jpg", "Attachments/Clippings/a.jpg"]])
    );
    expect(orphans).toEqual([]);
  });

  it("flags derived files whose original is orphaned", () => {
    const orphans = findOrphans(
      ["Attachments/Clippings/gone.jpg", "Attachments/Clippings/gone.thumb.webp"],
      [],
      cache([["https://x.com/gone.jpg", "Attachments/Clippings/gone.jpg"]])
    );
    expect(orphans).toContain("Attachments/Clippings/gone.thumb.webp");
  });

  it("leaves unknown files alone rather than deleting them", () => {
    const orphans = findOrphans(
      ["Attachments/Clippings/stranger.png"],
      [],
      new MediaCache()
    );
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cleanup.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/cleanup.ts`**

Note the deliberate conservatism: a file the plugin does not recognize is never a deletion candidate.

```ts
import type { MediaCache } from "./cache";
import { dedupeMedia, normalizeUrl } from "./normalize";
import type { ClippingRecord } from "./scan";

function stripDerivedSuffix(path: string): string {
  return path.replace(/\.(thumb|poster)\.webp$/i, "");
}

export function findOrphans(
  archivedFiles: string[],
  records: ClippingRecord[],
  cache: MediaCache
): string[] {
  const liveKeys = new Set<string>();
  for (const record of records) {
    for (const media of dedupeMedia(record.media)) liveKeys.add(normalizeUrl(media.key));
  }

  const liveFiles = new Set<string>();
  const knownFiles = new Set<string>();
  for (const entry of cache.entries()) {
    if (!entry.file) continue;
    knownFiles.add(entry.file);
    if (entry.thumb) knownFiles.add(entry.thumb);
    if (liveKeys.has(entry.key)) {
      liveFiles.add(entry.file);
      if (entry.thumb) liveFiles.add(entry.thumb);
    }
  }

  return archivedFiles.filter((file) => {
    if (liveFiles.has(file)) return false;
    if (knownFiles.has(file)) return true;
    const base = stripDerivedSuffix(file);
    if (base === file) return false;
    return [...knownFiles].some((known) => stripDerivedSuffix(known) === base);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cleanup.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Implement `src/settings-tab.ts`**

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type ClippingsGridPlugin from "./main";

export class ClippingsGridSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ClippingsGridPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Clippings folder")
      .setDesc("Folder scanned for clippings.")
      .addText((text) =>
        text.setValue(this.plugin.settings.clippingsFolder).onChange(async (value) => {
          this.plugin.settings.clippingsFolder = value.trim() || "Clippings";
          await this.plugin.saveSettings();
          await this.plugin.index.rebuild();
        })
      );

    new Setting(containerEl)
      .setName("Attachment folder")
      .setDesc("Where archived images and video are stored.")
      .addText((text) =>
        text.setValue(this.plugin.settings.attachmentFolder).onChange(async (value) => {
          this.plugin.settings.attachmentFolder = value.trim() || "Attachments/Clippings";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Archive new clippings automatically")
      .setDesc("Download media as soon as a clipping appears.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.archiveOnCreate).onChange(async (value) => {
          this.plugin.settings.archiveOnCreate = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Autoplay video")
      .setDesc("Play video tiles when they are in view. Reduce Motion always wins.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoplayVideo).onChange(async (value) => {
          this.plugin.settings.autoplayVideo = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Maximum file size (MB)")
      .setDesc("Downloads larger than this are skipped.")
      .addText((text) =>
        text
          .setValue(String(Math.round(this.plugin.settings.maxBytes / 1048576)))
          .onChange(async (value) => {
            const mb = Number(value);
            if (Number.isFinite(mb) && mb > 0) {
              this.plugin.settings.maxBytes = Math.round(mb * 1048576);
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Thumbnail width (px)")
      .setDesc("Grid thumbnails are generated at this width.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.thumbnailWidth)).onChange(async (value) => {
          const width = Number(value);
          if (Number.isFinite(width) && width >= 100) {
            this.plugin.settings.thumbnailWidth = Math.round(width);
            await this.plugin.saveSettings();
          }
        })
      );
  }
}
```

- [ ] **Step 6: Register the tab and the cleanup command in `src/main.ts`**

```ts
import { Notice, normalizePath } from "obsidian";
import { findOrphans } from "./cleanup";
import { ClippingsGridSettingTab } from "./settings-tab";
```

In `onload`:

```ts
    this.addSettingTab(new ClippingsGridSettingTab(this.app, this));

    this.addCommand({
      id: "clean-unused-clipping-media",
      name: "Clean unused clipping media",
      callback: () => void this.cleanOrphans(),
    });
```

And the method:

```ts
  async cleanOrphans(): Promise<void> {
    const folder = normalizePath(this.settings.attachmentFolder);
    if (!(await this.app.vault.adapter.exists(folder))) return;
    const listing = await this.app.vault.adapter.list(folder);
    const orphans = findOrphans(listing.files, this.index.records(), this.archiver.cache);

    if (orphans.length === 0) {
      new Notice("Clippings grid: no unused media found");
      return;
    }

    for (const path of orphans) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) await this.app.fileManager.trashFile(file);
    }
    new Notice(`Clippings grid: moved ${orphans.length} unused files to trash`);
  }
```

Files go to the trash rather than being erased, so a mistake is recoverable.

- [ ] **Step 7: Verify in the vault**

Open Settings, Community plugins, Clippings Grid.
Expected: six settings render and persist across a reload. Run "Clean unused clipping media" with everything intact and confirm it reports no unused media, which proves it is not over-eager.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: settings tab and conservative orphan cleanup"
```

---

### Task 15: Performance verification, README, and release

**Files:**
- Create: `scripts/generate-fixture-vault.mjs`, `README.md`, `LICENSE`, `.github/workflows/release.yml`, `versions.json`
- Test: manual performance run

**Interfaces:**
- Consumes: everything.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the fixture vault generator**

Create `scripts/generate-fixture-vault.mjs`. It writes 500 clipping notes plus solid-color PNGs of varying aspect ratios, so the grid can be exercised at scale without hitting the network.

```js
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { deflateSync } from "zlib";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/generate-fixture-vault.mjs <vault-path>");
  process.exit(1);
}

const clippings = join(target, "Clippings");
const attachments = join(target, "Attachments", "Clippings");
mkdirSync(clippings, { recursive: true });
mkdirSync(attachments, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CATEGORIES = ["design", "dev", "product", "games", "tools", "gear", "reference"];
const SPECIFICS = ["ios", "swiftui", "cli", "manga", "indie", "interaction", "roguelike"];
const RATIOS = [[400, 300], [300, 400], [400, 400], [400, 225], [300, 500]];

for (let i = 0; i < 500; i++) {
  const [w, h] = RATIOS[i % RATIOS.length];
  const name = `fixture-${String(i).padStart(3, "0")}.png`;
  writeFileSync(join(attachments, name), png(w, h, (i * 37) % 256, (i * 91) % 256, (i * 53) % 256));

  const note = `---
title: "Fixture clipping ${i}"
source: "https://example-${i % 20}.com/article/${i}"
description: "Synthetic clipping ${i} for performance testing"
created: 2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}
tags:
  - "clippings"
type: clipping
categories:
  - ${CATEGORIES[i % CATEGORIES.length]}
  - ${SPECIFICS[i % SPECIFICS.length]}
status: ${i % 3 === 0 ? "read" : "unread"}
cover: "Attachments/Clippings/${name}"
---

Synthetic body for fixture ${i}.
`;
  writeFileSync(join(clippings, `Fixture ${String(i).padStart(3, "0")}.md`), note);
}

console.log("Wrote 500 fixture clippings to", clippings);
```

- [ ] **Step 2: Generate a throwaway fixture vault and measure**

```bash
node scripts/generate-fixture-vault.mjs /tmp/cg-fixture-vault
```

Open `/tmp/cg-fixture-vault` as a vault in Obsidian, install the plugin into it (copy `.obsidian/plugins/clippings-grid/` across, or point `VAULT_PLUGIN_DIR` at it and rebuild), and open the grid.

Measure with the developer console (Cmd+Option+I):
- Wrap `refresh()` in `performance.mark`/`performance.measure`, or simply run `performance.now()` before and after `app.workspace.getLeavesOfType('clippings-grid')[0].view.refresh()`.
- Record with the Performance tab while scrolling the full height.

Expected: refresh under 100ms, and scrolling that holds frame rate with no long tasks over 50ms. If either misses, the likely causes in order are: thumbnails not being used (check that tiles point at `.thumb.webp`), the tile pool not recycling (watch DOM node count while scrolling), or too many videos playing at once.

- [ ] **Step 3: Record the measured numbers in the README**

Do not write aspirational numbers. Write what you measured, on what hardware.

- [ ] **Step 4: Write `README.md`**

```markdown
# Clippings Grid

A fast masonry grid over your Obsidian web clippings, with local media archiving so a clipping survives its source site.

## What it does

- Renders every note in your clippings folder as one tile, using its best image or video as the cover.
- Downloads every image and video a clipping references into your vault, so the collection is yours even after the source disappears.
- Repairs dead image links at render time, without ever rewriting a note.
- Filters by category and status, and searches title, description, domain, and categories.
- Plays video tiles in view, capped and paused off-screen so scrolling stays smooth.

## It never edits your notes

Archived filenames are derived from a hash of the source URL, so the mapping from remote URL to local file needs no record. No frontmatter key is added, no body text is changed. Add a `cover:` property yourself if you want to override an auto-picked cover.

## Install

Via [BRAT](https://github.com/TfTHacker/obsidian42-brat): add this repository as a beta plugin.

## Settings

| Setting | Default |
|---|---|
| Clippings folder | `Clippings` |
| Attachment folder | `Attachments/Clippings` |
| Archive new clippings automatically | on |
| Autoplay video | on |
| Maximum file size | 25MB |
| Thumbnail width | 400px |

## Commands

- **Open clippings grid**
- **Archive all clipping media**
- **Clean unused clipping media** (moves to trash, never erases)

## Development

```bash
npm install
npm run dev     # builds into VAULT_PLUGIN_DIR with a .hotreload marker
npm test
```

## License

MIT
```

- [ ] **Step 5: Add `LICENSE` (MIT) and `versions.json`**

```json
{
  "0.1.0": "1.5.0"
}
```

- [ ] **Step 6: Add the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "*"

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20.x"
      - run: npm ci
      - run: npm test
      - run: npm run build
      - name: Create release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --title "$GITHUB_REF_NAME" \
            --generate-notes \
            dist/main.js manifest.json styles.css
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test && npm run build`
Expected: all tests pass across all suites, and `tsc --noEmit` reports no errors.

- [ ] **Step 8: Commit and tag**

```bash
git add -A
git commit -m "docs: readme, license, release workflow and fixture vault generator"
git tag 0.1.0
```

---

## Self-Review Notes

Checked against the spec, section by section:

- Scanner, URL normalizer, archiver, derived assets and cache, in-memory index, grid view, render repair: Tasks 2, 3, 7, 8, 9, 4, 10, 13.
- The "never writes to notes" constraint: enforced by design in Task 8 and verified in Task 13 Step 6.
- Performance requirements: Tasks 6, 9, 10, 11, verified in Task 15.
- Failure handling (Referer retry, fallback chain, size cap, offline, unparseable header, deleted note): Tasks 7, 10, 14.
- Settings: Task 14.
- Testing plan including the fixture vault: distributed across tasks, with the perf run in Task 15.

Type consistency confirmed across tasks: `MediaRef`, `ClippingRecord` (including the `cover` field added in Task 10 Step 3), `CanonicalMedia`, `ArchiveOutcome`, `CacheEntry`, `TileModel`, `Position`, `LayoutResult`, and `FilterState` keep the same names and shapes wherever they are consumed. `hashUrl` returns 12 hex characters in every use. `isInFolder` is defined in Task 4 and reused in Task 13.
