// The check the Obsidian community directory runs on every submission and
// release. Run `npm run lint` before anything is pushed.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // The build script is not plugin code: it runs under node, on purpose.
  { ignores: ["dist/**", "node_modules/**", "esbuild.config.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*", "vitest.config.ts"],
        },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["Oriko"] }],
    },
  },
  {
    // Tests run under node, not in Obsidian: they may evaluate scanner
    // scripts, read fixtures from disk and use bare timers.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-implied-eval": "off",
      "obsidianmd/rule-custom-message": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/prefer-window-timers": "off",
    },
  },
]);
