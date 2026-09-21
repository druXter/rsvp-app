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
  // Die Bootstrap-Skripte im Repo-Root sind bewusst klassische CommonJS-Node-Skripte
  // (per `node create-user.js` etc. ausgeführt, siehe CLAUDE.md) statt Teil der
  // TypeScript/Next.js-App - require() ist hier die korrekte, keine zu ersetzende Syntax.
  {
    files: ["create-user.js", "seed.js", "set-role.js", "migrate-token-hashes.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Eigenständige Node-Skripte (CommonJS, laufen ohne Build) - kein App-Code.
    "migrate-token-hashes.js",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
