import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: { NODE_ENV: "test", PROTOTYPE_TEST_MODE: "true", PROTOTYPE_DB_PATH: ".data/e2e.sqlite" },
  },
})
