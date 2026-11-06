/**
 * Takes a picture of the main pages, for a visual review. Does nothing unless SCREENSHOT_DIR is set:
 *   SCREENSHOT_DIR=/tmp/shots npm run e2e -- screenshots
 */
import { chromium } from 'playwright';

const dir = process.env.SCREENSHOT_DIR;
if (!dir) process.exit(0);
const APP = process.env.APP_URL || 'http://localhost:4173';
const { mkdirSync } = await import('node:fs');
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport })).newPage();
    for (const [name, path] of [['landing', '/'], ['dashboard', '/dashboard'], ['roadmap', '/roadmap'], ['lab-studio', '/lab'], ['login', '/login?tab=lab'], ['lesson', '/unit/linux-basics/learn']]) {
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${dir}/${label}-${name}.png`, fullPage: false });
    }
  }
  console.log(`  pictures saved in ${dir}`);
} finally {
  await browser.close();
}
