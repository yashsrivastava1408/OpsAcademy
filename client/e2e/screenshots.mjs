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
    for (const [name, path] of [['landing', '/'], ['dashboard', '/dashboard'], ['roadmap', '/roadmap'], ['lab-studio', '/lab'], ['login', '/login?tab=lab'], ['lesson', '/unit/linux-basics/learn'], ['prepare', '/unit/linux-basics/prepare'], ['case-studies', '/casestudies'], ['lab-page', '/lab/linux-basics'], ['lesson-forensics', '/unit/digital-forensics/learn'], ['lesson-gitops', '/unit/gitops-argocd/learn']]) {
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${dir}/${label}-${name}.png`, fullPage: false });
    }
  }
  // The splash screen skips automated browsers on purpose, so this context pretends to be a person.
  const human = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await human.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await human.goto(`${APP}/`, { waitUntil: 'commit' });
  for (const ms of [350, 800, 1000]) {
    await human.waitForTimeout(ms);
    await human.screenshot({ path: `${dir}/splash-${ms}.png` });
  }
  await human.waitForTimeout(1600);
  await human.screenshot({ path: `${dir}/splash-after.png` });
  // A lesson further down: takeaways and the next section.
  const reader = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await reader.goto(`${APP}/unit/gitops-argocd/learn`, { waitUntil: 'networkidle' });
  await reader.evaluate(() => window.scrollTo(0, 1500));
  await reader.waitForTimeout(500);
  await reader.screenshot({ path: `${dir}/lesson-scrolled.png` });
  await reader.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await reader.waitForTimeout(500);
  await reader.screenshot({ path: `${dir}/lesson-bottom.png` });
  console.log(`  pictures saved in ${dir}`);
} finally {
  await browser.close();
}
