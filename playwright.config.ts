import { defineConfig, devices } from '@playwright/test';

// Port 5183 unless told otherwise, so that this suite never collides with `pnpm dev`
// on 5173. The suite runs against the built site: the page at the root and the
// studio under app/, which is what gets hosted.
const PORT = Number(process.env.CONTOUR_E2E_PORT ?? 5183);

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm build:site && pnpm exec vite preview --outDir dist-site --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
      grep: /@cross/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
      grep: /@cross/,
    },
  ],
});
