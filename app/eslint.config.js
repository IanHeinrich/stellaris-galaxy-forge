import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

/** The layers a shared module may not reach up into; see `src/lib/README.md`. */
const UPWARDS = [
  {
    group: ["**/store/*", "**/map/*", "**/map/**", "**/panels/*", "**/panels/**"],
    message: "lib/ is shared by the app's layers and may not import from them (src/lib/README.md).",
    allowTypeImports: true,
  },
];

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/", "src/generated/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: UPWARDS }] },
  },
  {
    // Localising a name needs the loaded game data, so this reads a store.
    files: ["src/lib/names.ts", "src/lib/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [{ ...UPWARDS[0], group: ["**/map/*", "**/map/**", "**/panels/**"] }] },
      ],
    },
  },
  {
    files: ["src/store/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/map/*", "**/map/**", "**/panels/*", "**/panels/**"],
              message:
                "The stores hold the document; the map and the panels read them (src/lib/README.md).",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/map/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/panels/*", "**/panels/**"],
              message: "The map draws itself; the panels read it, never the other way round.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  prettier,
);
