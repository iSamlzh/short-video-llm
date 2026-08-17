import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "tsx src/scripts/e2e-server.ts",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
  },
})
