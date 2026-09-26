import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual-snapshot',
  outputDir: './test-results/snapshot-visual',
  fullyParallel: true,
  reporter: 'list',
  use: {
    ...devices['iPhone 13'],
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium'
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort --outDir dist-snapshot',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
