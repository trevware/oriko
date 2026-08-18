import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const vaultDir =
  process.env.VAULT_PLUGIN_DIR ||
  "/Users/trevor/Documents/Aegis/.obsidian/plugins/power-grid";

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
