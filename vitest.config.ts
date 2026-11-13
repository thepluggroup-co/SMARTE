import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./tests/preparation.ts",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
