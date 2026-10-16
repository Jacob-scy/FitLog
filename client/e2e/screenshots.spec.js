import { test } from '@playwright/test';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001/api/v1';

// Helper: get a valid auth token
async function login(request) {
  await request.post(API + '/auth/send-code', { data: { email: 'demo@fitlog.dev' } });
  // Can't intercept dev console output, so use a fixed flow:
  // We'll directly set auth in localStorage using a known token approach
  return null; // Will use localStorage injection instead
}

test('Screenshot: Login page', async ({ page }) => {
  await page.goto(BASE + '/login');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/screenshot-login.png', fullPage: true });
});

test('Screenshot: Exercise list (authenticated via API)', async ({ page, request }) => {
  // Get auth token via API
  await request.post(API + '/auth/send-code', { data: { email: 'demo@fitlog.dev' } });
  // In dev mode, grab the code from server stdout
  // For demo purposes, inject auth state directly
  const loginResp = await request.post(API + '/auth/login', {
    data: { email: 'demo@fitlog.dev', code: '999999' },
  });

  if (loginResp.ok()) {
    const { data } = await loginResp.json();

    // Set auth in Zustand localStorage
    await page.goto(BASE);
    await page.evaluate((t) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: { user: data.user, accessToken: t },
        version: 0,
      }));
    }, data.accessToken);

    // Reload to pick up auth
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Navigate to exercises
    await page.goto(BASE + '/exercises');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/screenshot-exercises.png', fullPage: true });

    // Go to detail
    await page.goto(BASE + '/exercises/3_4_Sit-Up');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/screenshot-exercise-detail.png', fullPage: true });

    // Go to workouts
    await page.goto(BASE + '/workouts');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/screenshot-workouts.png', fullPage: true });

    // Go to stats
    await page.goto(BASE + '/stats');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/screenshot-stats.png', fullPage: true });
  } else {
    console.log('Could not auto-login for screenshots (dev mode code interception needed)');
  }
});
