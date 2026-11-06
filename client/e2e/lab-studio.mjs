/**
 * Browser checks for the theory / lab split: Lab Studio lists every topic, theory pages have no Practice
 * button, old practice links still arrive in the lab, the Lab login tab exists, and the navbar is lean.
 * The gateway runs with LAB_POLICY=open here, so a signed-in learner can open a lab; the Lab ID, slot and
 * queue rules are covered by the server tests.
 */
import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://localhost:4173';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`); };

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // ── Theory side ──
  await page.goto(`${APP}/dashboard`, { waitUntil: 'networkidle' });
  const cards = await page.locator('.unit-modes-footer').count();
  check('the dashboard shows topic cards', cards > 0, `${cards} cards`);
  check('no theory card has a Practice button', (await page.locator('.unit-modes-footer .mode-practice').count()) === 0);
  check('the navbar has Lab Studio and no engine badge or GitHub icon',
    (await page.getByRole('link', { name: /Lab Studio/ }).count()) > 0
    && (await page.locator('.nav-telemetry-badge').count()) === 0
    && (await page.locator('a[href*="github.com"]').count()) === 0);

  // ── Roadmap as cards ──
  await page.goto(`${APP}/roadmap`, { waitUntil: 'networkidle' });
  check('the roadmap is a grid of stage cards', (await page.locator('.oa-grid .oa-card').count()) >= 8);
  check('roadmap cards link to theory and prepare, not to the lab',
    (await page.locator('.oa-card a[href$="/learn"]').count()) > 0 && (await page.locator('.oa-card a[href*="/lab"]').count()) === 0);

  // ── Lab Studio ──
  await page.getByRole('link', { name: /Lab Studio/ }).first().click();
  await page.waitForURL(/\/lab$/);
  await page.locator('.lab-home .oa-card').first().waitFor({ timeout: 15000 });
  const labCards = await page.locator('.lab-home .oa-card').count();
  check('Lab Studio opens at /lab straight away and lists every topic', labCards === cards, `${labCards} topics`);
  await page.getByLabel('Search topics').fill('docker');
  const found = await page.locator('.lab-home .oa-card').count();
  check('the topic search narrows the list', found > 0 && found < labCards, `${found} match`);

  // ── Opening a lab ──
  await page.locator('.lab-home .oa-card a', { hasText: 'Open lab' }).first().click();
  await page.waitForURL(/\/lab\/[a-z0-9-]+$/);
  await page.getByRole('button', { name: /Start Lab/ }).first().waitFor({ timeout: 15000 });
  check('Open lab goes straight to the lab page with a Start button', true);
  check('inside the lab the switch says Back to Theory', (await page.getByRole('link', { name: /Back to Theory/ }).count()) > 0);

  // ── Old links ──
  await page.goto(`${APP}/unit/linux-basics/practice`, { waitUntil: 'networkidle' });
  check('an old /practice link arrives in the lab', /\/lab\/linux-basics$/.test(page.url()), page.url());

  // ── Lab login ──
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${APP}/login?tab=lab`, { waitUntil: 'networkidle' });
  check('the Lab login tab opens from the link and asks for a Lab ID', (await page.getByText('Lab ID', { exact: true }).count()) > 0 && (await page.getByRole('button', { name: /Enter with Lab ID/ }).count()) > 0);
  check('the sign-in page has no email field on the Lab tab', (await page.locator('input[type="email"]').count()) === 0);

  check('no JavaScript errors', errors.length === 0, errors.join(' | ').slice(0, 200));
} catch (error) {
  console.log(`LAB STUDIO CHECKS CRASHED: ${error.message.split('\n')[0]}`);
  results.push(false);
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} lab studio checks passed.`);
process.exit(passed === results.length ? 0 : 1);
