import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  js.configs.recommended,
  globalIgnores([
    "build/**",
    "dist/**",
    ".output/**",
    ".vinext/**",
    ".wrangler/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
