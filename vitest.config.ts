import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["dotenv/config"], // loads .env (DATABASE_URL etc.) for integration tests
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Neon database; keep DB-touching files serial.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
