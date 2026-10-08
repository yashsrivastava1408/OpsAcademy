/**
 * Browser checks for the account and extra pages: email confirmation,
 * password reset, public profile, case studies, the operator page, the
 * "sandbox is closing" warning, steps staying verified after a reload, and
 * the phone layout of the lab.
 *
 * Needs the gateway started with ADMIN_TOKEN=e2e-admin-token and no mail
 * provider (run.mjs does both), so reset and confirmation links are handed
 * back by the API instead of being emailed.
 */
import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://localhost:4173';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'e2e-admin-token';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`); };

/** On a failing run, keep a picture of where the browser ended up (see run.mjs). */
async function keepScreenshot(target, name) {
  if (!process.env.E2E_ARTIFACTS || !target) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(process.env.E2E_ARTIFACTS, { recursive: true });
  await target.screenshot({ path: `${process.env.E2E_ARTIFACTS}/${name}.png`, fullPage: true }).catch(() => {});
}
let lastPage = null;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  lastPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const sleep = (ms) => page.waitForTimeout(ms);
  const visible = (locator) => locator.first().isVisible().catch(() => false);

  const email = `features-${Date.now()}@example.com`;
  const oldPassword = 'first-password-123';
  const newPassword = 'second-password-456';

  // ── Sign up and confirm the email address ────────────────
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="text"]').fill('Priya Sharma');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(oldPassword);
  await page.locator('.auth-submit').click();
  await page.waitForURL('**/dashboard');
  await page.waitForSelector('.account-tools');
  check('a new account is told its email is not confirmed', await visible(page.getByText('Your email address is not confirmed yet.')));
  await page.getByRole('button', { name: 'Send link again' }).click();
  await page.getByRole('link', { name: 'Open the confirmation link' }).click();
  await page.waitForSelector('.verify-card h1');
  check('the confirmation link confirms the address', (await page.locator('.verify-card h1').innerText()) === 'Email confirmed' && (await page.locator('.verify-card').innerText()).includes(email));
  const usedLink = page.url();
  await page.getByRole('link', { name: 'Go to the dashboard' }).click();
  await page.waitForSelector('.account-tools');
  check('the dashboard no longer asks to confirm the email', !(await visible(page.getByText('Your email address is not confirmed yet.'))));
  const second = await context.newPage();
  await second.goto(usedLink, { waitUntil: 'networkidle' });
  check('a confirmation link works only once', (await second.locator('.verify-card h1').innerText()) === 'Could not confirm');
  await second.close();

  // ── Lab of the day ───────────────────────────────────────
  check('the dashboard shows the lab of the day', await visible(page.locator('.daily-card')) && /\+15 XP/.test(await page.locator('.daily-card').innerText()));
  const dailyHref = await page.locator('.daily-card a').getAttribute('href');
  check('the lab of the day links to a practice lab', /^\/unit\/[a-z0-9-]+\/practice$/.test(dailyHref || ''), dailyHref);

  // ── Public profile ───────────────────────────────────────
  await page.getByRole('button', { name: 'Share my profile' }).click();
  await page.waitForSelector('.account-row a[href^="/u/"]');
  const profilePath = await page.locator('.account-row a[href^="/u/"]').getAttribute('href');
  check('sharing gives the profile an address built from the name', /^\/u\/priya-sharma-[0-9a-f]{6}$/.test(profilePath), profilePath);
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`${APP}${profilePath}`, { waitUntil: 'networkidle' });
  check('a signed-out visitor can open the shared profile', (await visitor.locator('.profile-header h1').innerText().catch(() => '')) === 'Priya Sharma');
  check('the profile shows achievements and no email address', (await visitor.locator('.profile-stat').count()) === 4 && !(await visitor.locator('body').innerText()).includes(email));
  check('viewing a profile creates no account for the visitor', !(await visitor.evaluate(() => localStorage.getItem('opsacademy_token'))));
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await page.waitForFunction(() => !document.querySelector('.account-row a[href^="/u/"]'));
  await visitor.reload({ waitUntil: 'networkidle' });
  check('after sharing is turned off the address shows "Profile not found"', await visible(visitor.getByText('Profile not found')));
  await visitorContext.close();

  // ── Password reset ───────────────────────────────────────
  await page.locator('.nav-user button').click();
  await page.waitForFunction(() => !document.querySelector('.nav-user'));
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await page.locator('.auth-tab', { hasText: 'Log in' }).click();
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  check('the forgot-password form asks only for an email', (await page.locator('input[type="password"]').count()) === 0);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('.auth-submit').click();
  await page.waitForSelector('.auth-notice');
  check('asking for a reset shows a neutral message', (await page.locator('.auth-notice').innerText()).includes('If an account uses that email address'));
  await page.getByRole('link', { name: 'choose a new password' }).click();
  await page.waitForSelector('.auth-title');
  await page.locator('input[type="password"]').fill(newPassword);
  await page.locator('.auth-submit').click();
  await page.waitForURL('**/dashboard');
  await page.waitForSelector('.nav-user-name');
  check('the reset link sets a new password and signs in', (await page.locator('.nav-user-name').innerText()) === 'Priya Sharma');
  await page.locator('.nav-user button').click();
  await page.waitForFunction(() => !document.querySelector('.nav-user'));
  const tryLogin = async (password) => {
    await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
    await page.locator('.auth-tab', { hasText: 'Log in' }).click();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('.auth-submit').click();
    await Promise.race([page.waitForURL('**/dashboard'), page.waitForSelector('.auth-error')]);
    return page.url().endsWith('/dashboard');
  };
  check('the old password no longer works', (await tryLogin(oldPassword)) === false);
  check('the new password works', (await tryLogin(newPassword)) === true);
  await page.goto(`${APP}/reset-password`, { waitUntil: 'networkidle' });
  check('a reset page without a token says the link is incomplete', await visible(page.getByText('This link is incomplete')));

  // ── Case studies ─────────────────────────────────────────
  await page.goto(`${APP}/casestudies`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.more-case-card');
  check('the case-study index lists the other units that have one', (await page.locator('.more-case-card').count()) === 2);
  await page.locator('.more-case-card').first().click();
  await page.waitForSelector('.case-card');
  check('a card-style case study renders its cases', (await page.locator('.case-card').count()) >= 1 && (await page.locator('.case-card-outcomes li').count()) >= 1);
  await page.goto(`${APP}/unit/realworld-internship-case-study/casestudy`, { waitUntil: 'networkidle' });
  check('a written post-mortem renders its sections', (await page.locator('.learn-section').count()) >= 4 && (await page.locator('.learn-paragraph').count()) > 3);
  await page.goto(`${APP}/unit/linux-basics/casestudy`, { waitUntil: 'networkidle' });
  check('a unit without a case study says so', await visible(page.getByText('This unit has no case study')));

  // ── Lab: verified steps survive a reload; closing warning ─
  await page.goto(`${APP}/unit/linux-basics/practice`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Start Lab/ }).first().click();
  await page.waitForSelector('.terminal-status.connected');
  await page.locator('.terminal-body').click();
  await page.keyboard.type('mkdir -p webapp/src webapp/public webapp/config && touch webapp/src/index.js webapp/public/index.html webapp/config/app.conf\n');
  await sleep(900);
  await page.getByRole('button', { name: 'Verify Step 2' }).click();
  await page.waitForFunction(() => /passed|Not there|Couldn/.test(document.querySelector('.verify-card h3')?.textContent || ''));
  const passed = /Verification passed/.test(await page.locator('.verify-card').innerText());
  await page.locator('.verify-card').getByRole('button', { name: 'Close' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.instruction-item');
  await page.waitForSelector('.instruction-item.step-verified', { timeout: 8000 }).catch(() => {});
  const ticked = await page.locator('.instruction-item.step-verified .instruction-title').allInnerTexts();
  check('a verified step is still ticked after a reload', passed && ticked.length === 1 && ticked[0].includes('Project Structure'), ticked.join(', '));

  await page.waitForSelector('.terminal-status.connected');
  check('no closing warning while the sandbox is fresh', (await page.locator('.lab-closing-banner').count()) === 0);
  // Pretend the gateway reports the sandbox as nearly idle-expired.
  await page.route('**/api/sandbox/*/history', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.session.idleExpiresAt = body.session.serverTime + 90000;
    await route.fulfill({ response, json: body });
  });
  await page.waitForSelector('.lab-closing-banner', { timeout: 10000 }).catch(() => {});
  const banner = await page.locator('.lab-closing-banner').innerText().catch(() => '');
  check('a warning with a countdown appears before an idle sandbox closes', /closes in 1:[0-3]\d/.test(banner), banner.replace(/\s+/g, ' '));
  await page.unroute('**/api/sandbox/*/history');
  const keepCalls = [];
  page.on('response', (res) => { if (res.url().endsWith('/keepalive')) keepCalls.push(res.status()); });
  page.on('requestfailed', (req) => { if (req.url().endsWith('/keepalive')) keepCalls.push(`failed: ${req.failure()?.errorText}`); });
  await page.getByRole('button', { name: 'Keep it open' }).click();
  await sleep(1500);
  check('"Keep it open" is accepted by the gateway', keepCalls.includes(200), `keepalive responses: ${JSON.stringify(keepCalls)}`);
  await page.waitForFunction(() => !document.querySelector('.lab-closing-banner'), null, { timeout: 8000 }).catch(() => {});
  check('"Keep it open" restarts the countdown and the warning goes away', (await page.locator('.lab-closing-banner').count()) === 0);

  // ── Operator page ────────────────────────────────────────
  const admin = await context.newPage();
  await admin.goto(`${APP}/admin`, { waitUntil: 'networkidle' });
  await admin.locator('input[type="password"]').fill('not-the-token');
  await admin.locator('.auth-submit').click();
  await admin.waitForSelector('.auth-error');
  check('the operator page rejects a wrong token', (await admin.locator('.auth-error').innerText()).includes('not accepted'));
  await admin.locator('input[type="password"]').fill(ADMIN_TOKEN);
  await admin.locator('.auth-submit').click();
  await admin.waitForSelector('.admin-tiles');
  check('the operator page shows the overview tiles', (await admin.locator('.admin-tile').count()) === 6);
  check('it reports email as not delivered on this stack', (await admin.locator('.admin-facts').innerText()).includes('links go to the server log'));
  await admin.waitForSelector('.admin-table tbody tr');
  check('it lists the running sandbox', (await admin.locator('.admin-table tbody tr').count()) === 1 && (await admin.locator('.admin-table tbody tr').innerText()).includes('linux-basics'));
  await admin.locator('.admin-table tbody tr button').click();
  await admin.waitForFunction(() => !document.querySelector('.admin-table tbody tr'), null, { timeout: 8000 }).catch(() => {});
  check('stopping a sandbox from the operator page removes it', (await admin.locator('.admin-table tbody tr').count()) === 0);
  await admin.close();
  await page.waitForSelector('.terminal-status.disconnected', { timeout: 10000 }).catch(() => {});
  check('the student sees their terminal close when an operator stops it', (await page.locator('.terminal-status.disconnected').count()) === 1);
  check('no JavaScript errors on the desktop pages', errors.length === 0, errors.slice(0, 3).join(' || '));
  await context.close();

  // ── Phone layout of the lab ──────────────────────────────
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  lastPage = mobile;
  const phoneErrors = [];
  mobile.on('pageerror', (e) => phoneErrors.push(e.message));
  await mobile.goto(`${APP}/unit/git-basics/practice`, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('.instruction-item', { timeout: 30000 });
  const box = async (selector) => mobile.locator(selector).first().boundingBox();
  check('phone: the panel switch is shown', await mobile.locator('.lab-panel-tabs').isVisible());
  check('phone: instructions use the full width', ((await box('.lab-instructions'))?.width || 0) > 370 && !(await mobile.locator('.lab-terminal').isVisible()));
  check('phone: the inspector starts closed', (await mobile.locator('.devops-inspector').count()) === 0);
  await mobile.getByRole('button', { name: /Start Lab/ }).first().click();
  await mobile.waitForSelector('.terminal-status.connected', { timeout: 15000 });
  const terminalBox = await box('.lab-terminal');
  check('phone: starting the lab switches to a full-width terminal', (terminalBox?.width || 0) > 370 && (terminalBox?.height || 0) > 250 && !(await mobile.locator('.lab-instructions').isVisible()), JSON.stringify(terminalBox));
  const cols = await mobile.evaluate(() => document.querySelector('.terminal-body > div').__xterm.cols);
  check('phone: the terminal has a usable number of columns', cols >= 35, `${cols} columns`);
  await mobile.locator('.terminal-body').click();
  await mobile.keyboard.type('echo phone-$((6*7))\n');
  await mobile.waitForFunction(() => document.querySelector('.xterm-rows').innerText.includes('phone-42'), null, { timeout: 8000 }).catch(() => {});
  check('phone: typing in the terminal works', (await mobile.evaluate(() => document.querySelector('.xterm-rows').innerText)).includes('phone-42'));
  await mobile.locator('.lab-panel-tabs button', { hasText: 'Instructions' }).click();
  check('phone: the tab switches back to the instructions', await mobile.locator('.lab-instructions').isVisible());
  // A page wider than the screen makes a phone zoom everything out, so measure against the real screen width.
  const pageWidth = () => mobile.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));
  check('phone: the lab page fits the screen width', (await pageWidth()) <= 391, `${await pageWidth()}px on a 390px screen`);
  await mobile.getByRole('button', { name: 'Stop' }).click();
  await mobile.waitForTimeout(600);
  for (const [name, path, ready] of [
    ['landing page', '/', '.hero-title'],
    ['dashboard', '/dashboard', '.lab-card'],
    ['lesson page', '/unit/linux-basics/learn', '.learn-section'],
    ['flashcards page', '/unit/linux-basics/prepare', '.flashcard-container'],
    ['case study page', '/unit/endpoint-security/casestudy', '.case-card'],
    ['sign-in page', '/login', '.auth-card'],
  ]) {
    await mobile.goto(`${APP}${path}`, { waitUntil: 'networkidle' });
    await mobile.waitForSelector(ready, { timeout: 10000 }).catch(() => {});
    const width = await pageWidth();
    check(`phone: the ${name} fits the screen width`, width <= 391, `${width}px on a 390px screen`);
    if (width > 391) {
      // Name the elements that stick out past the screen but whose parent does not.
      const culprits = await mobile.evaluate(() => {
        const rows = [];
        for (const el of document.querySelectorAll('body *')) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.right <= 392) continue;
          const parent = el.parentElement.getBoundingClientRect();
          if (parent.right <= 392 || box.width > parent.width + 1) {
            rows.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} (right edge ${Math.round(box.right)}px, ${Math.round(box.width)}px wide)`);
          }
        }
        return [...new Set(rows)].slice(0, 12);
      });
      for (const culprit of culprits) console.log(`          too wide: ${culprit}`);
    }
  }
  check('phone: no JavaScript errors', phoneErrors.length === 0, phoneErrors.join(' || '));
  await phone.close();
} catch (err) {
  console.error('FEATURE TEST CRASHED:', err);
  results.push(false);
  await keepScreenshot(lastPage, 'features');
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} feature checks passed.`);
process.exit(passed === results.length ? 0 : 1);
