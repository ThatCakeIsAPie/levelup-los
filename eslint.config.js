import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Stage names are renameable (src/data/stageNames): pages get them from
    // useStageNames(), never from the built-in constants.
    files: [
      "src/modules/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/routes/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/data",
              importNames: [
                "MILESTONE_LABEL",
                "MILESTONE_COLUMN_LABEL",
                "RECRUITING_BAND_LABEL",
                "CUSTOMER_MILESTONE_LABEL",
                "CUSTOMER_BAND_LABEL",
              ],
              message:
                "Stage names can be renamed per person: use useStageNames(pipeline) from @/data, never the built-in labels.",
            },
          ],
        },
      ],
    },
  },
  eslintPluginPrettier,
);
