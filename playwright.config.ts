import { defineConfig } from '@playwright/test';

// Each parallel worktree/agent should use its own port: E2E_PORT=4181 npx playwright test
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  // The 3D specs render with software WebGL (SwiftShader) on CI and in containers: run them one at a
  // time with a generous budget, otherwise timing-sensitive fly/walk tests starve each other.
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
