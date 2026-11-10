import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const MOCK_URL = "http://localhost:4664";
// Not 4663 (`npm run dev` holds it; this server must not be reused, bots off); 4665–4668 are the specs' own servers.
export const REAL_PORT = 4669;
const REAL_URL = `http://localhost:${REAL_PORT}`;
// Seeds `santinh.name` on every e2e origin, so pages skip the first-visit name dialog (P3-D5).
const STORAGE_STATE = fileURLToPath(new URL("./e2e/storage-state.json", import.meta.url));

// Headless runs have no GPU; SwiftShader gives WebGL2 in software.
const chromium = {
  ...devices["Desktop Chrome"],
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
};

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure", storageState: STORAGE_STATE },
  projects: [
    // Phase 01 specs: Vite dev server, every page opts into `?mock` (no server needed).
    { name: "mock", testIgnore: "realtime/**", use: { ...chromium, baseURL: MOCK_URL } },
    // Phase 02 specs: the real Node server serves the built client; bots off so 👥 counts are exact.
    { name: "realtime", testMatch: "realtime/**/*.spec.ts", use: { ...chromium, baseURL: REAL_URL } },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 4664 --strictPort",
      url: MOCK_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Never reuse: a leftover server runs with bots on and would skew the counts.
      command: `PORT=${REAL_PORT} FAKE_POPULATION=off npm run start`,
      cwd: "..",
      url: `${REAL_URL}/api/ping`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
