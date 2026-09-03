/**
 * Thin access to the host OS, desktop only.
 *
 * The bundle is CJS, so `require` here is the module-scope one Obsidian
 * provides, which resolves node builtins. On mobile it throws and every
 * caller degrades to doing nothing.
 */
export function nodeRequire(name: string): unknown {
  try {
    // Module-scope require is the only route to node builtins in Obsidian's
    // renderer: globalThis.require does not exist there, and this degrades
    // to null on mobile, which every caller treats as the tool being absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- module-scope require is the only route to node builtins in the renderer; it degrades to null on mobile, which every caller treats as the tool being absent
    return require(name);
  } catch {
    return null;
  }
}

interface FsModule {
  existsSync: (path: string) => boolean;
  copyFileSync: (from: string, to: string) => void;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
}

interface OsModule {
  homedir: () => string;
}

export function systemAvailable(): boolean {
  return nodeRequire("fs") !== null;
}

export function downloadsDir(): string | null {
  const os = nodeRequire("os") as OsModule | null;
  const fs = nodeRequire("fs") as FsModule | null;
  if (!os || !fs) return null;

  const dir = `${os.homedir()}/Downloads`;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

/** Copies a file into Downloads, never overwriting an existing one. */
export function copyToDownloads(absoluteSource: string, filename: string): string | null {
  const fs = nodeRequire("fs") as FsModule | null;
  const dir = downloadsDir();
  if (!fs || !dir) return null;

  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";

  let target = `${dir}/${filename}`;
  let n = 2;
  try {
    while (fs.existsSync(target)) {
      target = `${dir}/${stem} ${n}${ext}`;
      n++;
    }
    fs.copyFileSync(absoluteSource, target);
    return target;
  } catch {
    return null;
  }
}

export function revealInFinder(absolutePath: string): boolean {
  const electron = nodeRequire("electron") as
    | { shell?: { showItemInFolder: (p: string) => void } }
    | null;
  if (!electron?.shell) return false;
  try {
    electron.shell.showItemInFolder(absolutePath);
    return true;
  } catch {
    return false;
  }
}
