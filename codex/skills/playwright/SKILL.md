---
name: playwright
description: Build reliable Playwright browser tests with typed configuration, reusable fixtures, page objects, network interception, visual snapshots, and deterministic CI execution.
verified: 2026-08
---

# Playwright

Use Playwright for browser-level checks of critical flows, cross-browser behavior, network failure
handling, and stable visual output. Install it with `npm install --save-dev @playwright/test` and
`npx playwright install --with-deps`.

## Configuration

Keep browser, retry, trace, server, and artifact behavior in one typed config.

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

## Custom Fixture

Extend `test` when setup must be reusable and isolated. Override `/api/session` before navigation.

```ts
// tests/e2e/fixtures.ts
import { test as base, expect, type Page } from "@playwright/test";

type Fixtures = { authenticatedPage: Page };

export const test = base.extend<Fixtures>({
  authenticatedPage: async ({ page }, use) => {
    await page.route("**/api/session", async (route) => {
      await route.fulfill({ json: { user: { id: "user-1", role: "member" } } });
    });
    await page.goto("/dashboard");
    await use(page);
  },
});

export { expect };
```

## Page Object

Keep selectors and user actions together; expose outcomes through semantic locators.

```ts
// tests/e2e/pages/login-page.ts
import { expect, type Page } from "@playwright/test";

export class LoginPage {
  constructor(private readonly page: Page) {}

  async signIn(email: string, password: string): Promise<void> {
    await this.page.goto("/login");
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Sign in" }).click();
    await expect(this.page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  }
}
```

```ts
// tests/e2e/login.spec.ts
import { test } from "@playwright/test";
import { LoginPage } from "./pages/login-page";

test("member signs in", async ({ page }) => {
  await new LoginPage(page).signIn("member@example.test", "example-password");
});
```

## Network Intercept

Mock application APIs, not third-party UI. Test success and failure without external state.

```ts
// tests/e2e/orders.spec.ts
import { expect, test } from "@playwright/test";

test("shows an order returned by the API", async ({ page }) => {
  await page.route("**/api/orders", async (route) => {
    await route.fulfill({ status: 200, json: [{ id: "order-1", total: 24 }] });
  });
  await page.goto("/orders");
  await expect(page.getByRole("row", { name: /order-1.*24/i })).toBeVisible();
});

test("shows a retry action after an API failure", async ({ page }) => {
  await page.route("**/api/orders", (route) => route.abort("failed"));
  await page.goto("/orders");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
```

## Visual Snapshot

Stabilize data and viewport before comparison. Keep tolerances explicit and small.

```ts
// tests/e2e/dashboard.visual.spec.ts
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 720 } });

test("dashboard visual baseline", async ({ page }) => {
  await page.route("**/api/metrics", (route) =>
    route.fulfill({ json: { orders: 12, revenue: 480 } }),
  );
  await page.goto("/dashboard");
  await expect(page).toHaveScreenshot("dashboard.png", { maxDiffPixelRatio: 0.001 });
});
```

Create or approve baselines locally with `npx playwright test --update-snapshots`.

## CI Run

Install browsers once, then run the committed suite without interactive reporters:

```powershell
npx playwright install --with-deps
npx playwright test --reporter=line
```

## Reliability Rules

- Prefer `getByRole`, `getByLabel`, and auto-retrying `expect` assertions.
- Do not use `waitForTimeout`; wait for observable application state.
- Keep tests independent and make fixture data unique per test.
- Use `test.describe.serial` only when the product flow is inherently ordered.
- Retain traces and failure screenshots as CI artifacts for diagnosis.
