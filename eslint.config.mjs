import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next's core-web-vitals only enables a handful of jsx-a11y rules as
  // warnings; the full recommended set catches more (e.g. label-has-associated-control,
  // click-events-have-key-events, anchor-is-valid). Only the `rules`, not `plugins`, are
  // spread here - core-web-vitals already registers the jsx-a11y plugin itself, and flat
  // config errors ("Cannot redefine plugin") if it's registered a second time.
  { rules: jsxA11y.flatConfigs.recommended.rules },
  // Eigenständige Node-Skripte im Hauptordner (create-user.js, auskunft.js, seed.js, set-role.js, migrate-*.js, …):
  // CommonJS, laufen per `node <skript>` ohne Build (siehe CLAUDE.md) - require() ist dort richtig. "*.js" trifft nur
  // den Hauptordner und deckt jedes neue Skript dort ohne eigenen Eintrag ab; gelintet werden sie trotzdem (Regel in
  // suite-kit docs/KONVENTIONEN.md).
  { files: ["*.js"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
