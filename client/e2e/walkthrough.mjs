/**
 * Browser walk-through: a real Chromium plays a student through the built
 * client against a running gateway and AI hub: landing, dashboard, a lesson,
 * the lab terminal (typing, resize, reconnect, reload), verification, the
 * mentor, flashcards, a mock interview, sign-up and log-out.
 *
 * Run everything with `npm run e2e` (see run.mjs), or against a stack that
 * is already up:  APP_URL=... API_URL=... node e2e/walkthrough.mjs
 */
import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://localhost:4173';
const API = process.env.API_URL || 'http://localhost:4100';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = function (...args) { const ws = new Native(...args); window.__sockets.push(ws); return ws; };
    window.WebSocket.prototype = Native.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = Native[k];
  });
  const page = await context.newPage();

  let reqs = [];
  const errors = [];
  page.on('request', (r) => reqs.push({ url: r.url(), method: r.method() }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const api = (method, path) => reqs.filter((r) => r.method === method && r.url.startsWith(`${API}/api${path}`));
  const chunk = (name) => reqs.some((r) => r.url.includes(`/assets/${name}`));
  const termText = () => page.evaluate(() => document.querySelector('.xterm-rows')?.innerText || '');
  const token = () => page.evaluate(() => localStorage.getItem('opsacademy_token'));

  // ── 1. Landing ───────────────────────────────────────────
  let sizes = 0;
  page.on('response', async (res) => {
    if (res.url().includes('/assets/') && res.url().endsWith('.js')) {
      sizes += (await res.body().catch(() => Buffer.alloc(0))).length;
    }
  });
  await page.goto(APP, { waitUntil: 'networkidle' });
  check('landing page renders', await page.locator('.hero-title').isVisible());
  check('landing does not download the lab (terminal) code', !chunk('LabPage'));
  check('landing does not download the diagram library', !chunk('mermaid'));
  check('landing creates no guest account', api('POST', '/auth/guest').length === 0 && !(await token()));
  check('landing asks for no personal data (no /progress call)', api('GET', '/progress').length === 0);
  check('navbar shows live engine stats from the gateway', /Engine: \d+\/\d+ warm|Engine: pty/.test(await page.locator('.nav-telemetry-badge').innerText()), await page.locator('.nav-telemetry-badge').innerText());
  console.log(`        JavaScript downloaded for the landing page: ${(sizes / 1024).toFixed(0)} kB uncompressed`);
  const firstTab = await page.locator('.terminal-tab-btn.active').innerText();
  await sleep(3800);
  check('landing demo terminal still rotates', (await page.locator('.terminal-tab-btn.active').innerText()) !== firstTab);

  // ── 2. Public pages ──────────────────────────────────────
  await page.goto(`${APP}/verify/OPS-000000000000`, { waitUntil: 'networkidle' });
  check('certificate check page works for a made-up ID', await page.getByText('Not a valid certificate').isVisible());
  check('checking a certificate creates no guest account', !(await token()));
  await page.goto(`${APP}/no/such/page`, { waitUntil: 'networkidle' });
  check('unknown address shows a "Page not found" page', await page.getByText('Page not found').isVisible());

  // ── 3. Dashboard ─────────────────────────────────────────
  reqs = [];
  await page.goto(`${APP}/dashboard`, { waitUntil: 'networkidle' });
  const cards = await page.locator('.lab-card').count();
  check('dashboard lists every unit from the API', cards === 19, `${cards} cards`);
  check('dashboard creates exactly one guest identity', api('POST', '/auth/guest').length === 1 && Boolean(await token()));
  check('leaderboard and certificates are each fetched once on load', api('GET', '/progress/leaderboard').length === 1 && api('GET', '/certificates').length === 1,
    `leaderboard x${api('GET', '/progress/leaderboard').length}, certificates x${api('GET', '/certificates').length}`);

  // ── 4. Learn ─────────────────────────────────────────────
  await page.evaluate(() => window.scrollTo(0, 1500));
  await sleep(400);
  reqs = [];
  await page.locator('.lab-card', { hasText: 'Linux Fundamentals' }).locator('a.mode-learn').click();
  await page.waitForSelector('.learn-section');
  check('a new page opens at the top, not at the old scroll position', (await page.evaluate(() => window.scrollY)) < 5, `scrollY=${await page.evaluate(() => window.scrollY)}`);
  check('lesson renders its sections', (await page.locator('.learn-section').count()) > 3);
  await page.waitForFunction(() => document.querySelector('.mermaid-container svg'), null, { timeout: 15000 }).catch(() => {});
  const mermaidTotal = await page.locator('.learn-mermaid').count();
  const drawnAtTop = await page.locator('.mermaid-container svg').count();
  check('diagram library is fetched only when a lesson needs it', chunk('mermaid'));
  console.log(`        diagrams drawn before scrolling: ${drawnAtTop} of ${mermaidTotal}`);
  const tocBefore = await page.locator('.toc-item.active').innerText();
  // scroll through the lesson in steps, like a reader
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) { await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y); await sleep(120); }
  await sleep(1500);
  const drawnAfter = await page.locator('.mermaid-container svg').count();
  check('every diagram is drawn by the time it has been scrolled past', mermaidTotal > 0 ? drawnAfter === mermaidTotal : true, `${drawnAfter} of ${mermaidTotal}`);
  check('diagrams are drawn lazily (not all up front)', mermaidTotal < 2 || drawnAtTop < mermaidTotal, `${drawnAtTop} of ${mermaidTotal} at top`);
  const barWidth = await page.evaluate(() => parseFloat(document.querySelector('.reading-progress-bar').style.width));
  check('reading progress bar follows the scroll', barWidth > 90, `${barWidth}%`);
  const tocAfter = await page.locator('.toc-item.active').innerText();
  check('table of contents highlights the section being read', tocAfter !== tocBefore, `"${tocBefore}" -> "${tocAfter}"`);
  check('no diagram failed to render', (await page.locator('.learn-mermaid pre.diagram-box').count()) === 0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const copy = page.locator('.code-copy-btn').first();
  await copy.scrollIntoViewIfNeeded();
  await copy.click();
  await sleep(200);
  const copied = await page.getByText('Copied!').count();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy marks exactly one code block and fills the clipboard', copied === 1 && clip.length > 0, `${copied} marked, ${clip.length} chars`);
  // quiz
  const quiz = page.locator('.quiz-card').first();
  await quiz.scrollIntoViewIfNeeded();
  reqs = [];
  await quiz.locator('.quiz-option-btn').first().click();
  await sleep(600);
  check('answering a quiz is checked by the server', api('POST', '/progress/quiz').length === 1 && await quiz.locator('.quiz-explanation').isVisible());

  // ── 5. Practice lab ──────────────────────────────────────
  reqs = [];
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator('.learn-header a', { hasText: 'Practice Lab' }).click();
  await page.waitForSelector('.lab-workspace');
  check('unit details are reused from memory when switching mode', api('GET', '/units/linux-basics').filter((r) => r.url.endsWith('/units/linux-basics')).length === 0);
  check('lab instructions render', (await page.locator('.instruction-item').count()) > 3);
  check('the tip in the inspector matches this unit', (await page.locator('.tip-question').innerText()).includes('file permissions'), await page.locator('.tip-question').innerText());
  // both start buttons at once: must still be one sandbox
  reqs = [];
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter((b) => /Start Lab/.test(b.textContent));
    buttons.forEach((b) => b.click());
  });
  await page.waitForSelector('.terminal-status.connected', { timeout: 15000 });
  check('terminal connects (status Live)', true);
  check('clicking both Start buttons starts one sandbox', api('POST', '/sandbox/start').length === 1, `${api('POST', '/sandbox/start').length} start calls`);
  await page.locator('.terminal-body').click();
  await page.keyboard.type('echo hello-$((40+2))\n');
  await page.waitForFunction(() => document.querySelector('.xterm-rows').innerText.includes('hello-42'), null, { timeout: 8000 });
  check('typing in the terminal runs in the sandbox', true);
  check('the prompt is the lab prompt', (await termText()).includes('student@opsacademy'));

  // resize: the shell must learn the new width
  const colsOf = async (tag) => {
    await page.keyboard.type(`echo ${tag}-$(stty size | cut -d" " -f2)-end\n`);
    await page.waitForFunction((t) => new RegExp(`${t}-\\d+-end`).test(document.querySelector('.xterm-rows').innerText.replace(/\n/g, '')), tag, { timeout: 8000 });
    return Number((await termText()).replace(/\n/g, '').match(new RegExp(`${tag}-(\\d+)-end`))[1]);
  };
  const wide = await colsOf('wide');
  await page.setViewportSize({ width: 1000, height: 900 });
  await sleep(700);
  const narrow = await colsOf('narrow');
  check('shell width follows the terminal panel when it is resized', narrow < wide && narrow > 10, `${wide} -> ${narrow} columns`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(500);

  // timer ticks without re-rendering the instruction list
  await page.evaluate(() => {
    window.__mutations = 0;
    new MutationObserver((list) => { window.__mutations += list.length; }).observe(document.querySelector('.lab-instructions'), { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const t1 = await page.locator('.lab-timer').innerText();
  await sleep(2300);
  const t2 = await page.locator('.lab-timer').innerText();
  check('lab timer ticks', t1 !== t2, `${t1.trim()} -> ${t2.trim()}`);
  check('instruction panel is not touched while the timer ticks', (await page.evaluate(() => window.__mutations)) === 0);

  // background polling while visible, none while hidden
  reqs = [];
  await sleep(6500);
  const visibleHistory = api('GET', '/sandbox/').filter((r) => r.url.endsWith('/history')).length;
  const visibleTelemetry = api('GET', '/sandbox/').filter((r) => r.url.endsWith('/telemetry')).length;
  check('inspector and history refresh while the tab is visible', visibleHistory >= 1 && visibleTelemetry >= 1, `history x${visibleHistory}, telemetry x${visibleTelemetry} in 6.5s`);
  check('inspector lists what is in the sandbox', await page.locator('.devops-inspector').isVisible());
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(300);
  reqs = [];
  await sleep(6500);
  check('a hidden tab makes no background API calls', reqs.filter((r) => r.url.startsWith(API)).length === 0, `${reqs.filter((r) => r.url.startsWith(API)).length} calls in 6.5s`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(800);
  check('polling resumes the moment the tab is shown again', reqs.filter((r) => r.url.startsWith(API)).length >= 2);

  // dropped connection: must reconnect to the same sandbox by itself
  const sessionsBefore = (await (await fetch(`${API}/api/sandbox`, { headers: { Authorization: `Bearer ${await token()}` } })).json()).data;
  await page.evaluate(() => window.__sockets[window.__sockets.length - 1].close());
  await page.waitForFunction(() => document.querySelector('.xterm-rows').innerText.includes('Connection lost') || document.querySelector('.terminal-status.connecting'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForSelector('.terminal-status.connected', { timeout: 15000 }).catch(() => {});
  const live = await page.locator('.terminal-status.connected').count();
  check('a dropped terminal connection reconnects by itself', live === 1);
  check('earlier output is back on screen after reconnecting', (await termText()).includes('hello-42') || (await termText()).includes('narrow-'));
  await page.locator('.terminal-body').click();
  await page.keyboard.type('echo again-$((1+1))\n');
  await page.waitForFunction(() => document.querySelector('.xterm-rows').innerText.includes('again-2'), null, { timeout: 8000 }).catch(() => {});
  check('the terminal works after reconnecting', (await termText()).includes('again-2'));
  const sessionsAfter = (await (await fetch(`${API}/api/sandbox`, { headers: { Authorization: `Bearer ${await token()}` } })).json()).data;
  check('reconnecting kept the same sandbox (no second one started)', sessionsAfter.length === 1 && sessionsAfter[0].sessionId === sessionsBefore[0].sessionId);

  // verify a step that has not been done, then do the work and verify it
  await page.getByRole('button', { name: 'Verify Step 2' }).click();
  await page.waitForSelector('.verify-card h3');
  await page.waitForFunction(() => !/Verifying/.test(document.querySelector('.verify-card h3').textContent));
  check('a step that is not done yet fails verification', (await page.locator('.verify-card h3').innerText()).includes('Not there yet'), await page.locator('.verify-card h3').innerText());
  await page.locator('.verify-card').getByRole('button', { name: 'Close' }).click();
  await page.locator('.terminal-body').click();
  await page.keyboard.type('mkdir -p webapp/src webapp/public webapp/config && touch webapp/src/index.js webapp/public/index.html webapp/config/app.conf\n');
  await sleep(900);
  await page.getByRole('button', { name: 'Verify Step 2' }).click();
  await page.waitForFunction(() => /passed|Not there|Couldn/.test(document.querySelector('.verify-card h3')?.textContent || ''));
  const verdict = await page.locator('.verify-card').innerText();
  check('doing the work makes the step pass and awards XP', /Verification passed/.test(verdict) && /\+20 XP/.test(verdict), verdict.split('\n').slice(0, 2).join(' | '));
  await page.locator('.verify-card').getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => /XP/.test(document.querySelector('.nav-progress')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check('navbar XP updates after verifying', /\d+ XP/.test(await page.locator('.nav-progress').innerText().catch(() => '')));

  // mentor
  await page.getByRole('button', { name: 'AI Mentor' }).click();
  await page.locator('.mentor-input').fill('I am stuck, what should I do next?');
  await page.locator('.mentor-input').press('Enter');
  await page.waitForSelector('.msg-tier', { timeout: 15000 });
  const tier = await page.locator('.msg-tier').first().innerText();
  check('the mentor answers from the AI hub (not offline mode)', /hint 1 of 3/i.test(tier) && !/offline/i.test(tier), tier);
  const hintCalls = reqs.filter((r) => r.method === 'POST' && r.url.includes('/api/agent/hint')).map((r) => r.url.split('/api/agent/')[1]);
  check('the hint came through the streaming endpoint, with no second request', hintCalls.length === 1 && hintCalls[0] === 'hint/stream', hintCalls.join(', '));
  check('the finished hint leaves no half-written bubble', (await page.locator('.msg-mentor .msg-bubble').last().innerText()).length > 40 && (await page.locator('.loading-bubble').count()) === 0);
  await page.locator('.mentor-chat-header button').click();

  // reload: the running sandbox is picked up again
  const beforeReload = (await page.locator('.lab-timer').innerText()).trim();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.terminal-status.connected', { timeout: 15000 }).catch(() => {});
  check('after a reload the page reattaches to the running sandbox', (await page.locator('.terminal-status.connected').count()) === 1);
  const afterReload = (await page.locator('.lab-timer').innerText().catch(() => '')).trim();
  check('the timer continues instead of restarting at 00:00', afterReload >= beforeReload && afterReload !== '00:00', `${beforeReload} -> ${afterReload}`);
  check('files made before the reload are still listed', await page.locator('.file-tree-list', { hasText: 'webapp' }).isVisible().catch(() => false));

  // stop
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.waitForSelector('.terminal-status.disconnected');
  await sleep(500);
  const left = (await (await fetch(`${API}/api/sandbox`, { headers: { Authorization: `Bearer ${await token()}` } })).json()).data;
  check('Stop destroys the sandbox on the server', left.length === 0, `${left.length} left`);
  check('Start Lab is offered again after stopping', (await page.getByRole('button', { name: /Start Lab/ }).count()) >= 1);

  // ── 6. Prepare ───────────────────────────────────────────
  await page.locator('.lab-header a', { hasText: 'Prepare' }).click();
  await page.waitForSelector('.flashcard-container');
  const tabBefore = await page.locator('.prepare-tab').first().innerText();
  const frontBefore = await page.locator('.flashcard-front h3').innerText();
  await page.locator('.flashcard-container').click();
  await page.waitForSelector('.grade-row');
  reqs = [];
  await page.locator('.grade-btn', { hasText: 'Good' }).dblclick();
  await page.waitForFunction((front) => document.querySelector('.flashcard-front h3').textContent !== front, frontBefore, { timeout: 5000 }).catch(() => {});
  await sleep(500);
  const reviews = reqs.filter((r) => r.method === 'POST' && /\/review$/.test(r.url)).length;
  const deckGets = reqs.filter((r) => r.method === 'GET' && /\/progress\/flashcards\//.test(r.url)).length;
  check('grading a card is one request, even on a double click', reviews === 1 && deckGets === 0, `${reviews} review, ${deckGets} deck reloads`);
  const tabAfter = await page.locator('.prepare-tab').first().innerText();
  check('the next card is shown and the due count drops', tabAfter !== tabBefore && (await page.locator('.flashcard-front h3').innerText()) !== frontBefore, `${tabBefore.trim()} -> ${tabAfter.trim()}`);
  await page.locator('.prepare-tab', { hasText: 'Mock Interview' }).click();
  await page.locator('.mock-answer-input').fill('I would check file permissions with ls -la, look at the owner and group, then use chmod and chown to fix them, and verify running processes with ps aux and top.');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.waitForSelector('.mock-score', { timeout: 15000 });
  check('a mock interview answer is scored by the AI hub', /\d+/.test(await page.locator('.mock-score-value').innerText()));

  // ── 7. Account ───────────────────────────────────────────
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  const email = `walk-${Date.now()}@example.com`;
  await page.locator('input[type="text"]').fill('Walk Through');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('correct-horse-battery');
  await page.locator('.auth-submit').click();
  await page.waitForURL('**/dashboard');
  await page.waitForSelector('.leaderboard-list li.you');
  check('registering keeps the XP earned as a guest', /\d+ XP/.test(await page.locator('.nav-progress').innerText()));
  check('the leaderboard shows the new name straight away', (await page.locator('.leaderboard-list li.you').innerText()).includes('Walk Through'), await page.locator('.leaderboard-list li.you').innerText());
  check('the unit card shows step progress', await page.locator('.lab-card', { hasText: 'Linux Fundamentals' }).locator('.unit-progress').isVisible());
  await page.locator('.nav-user button').click();
  await page.waitForFunction(() => !document.querySelector('.nav-user'));
  await page.waitForFunction(() => !document.querySelector('.leaderboard-list li.you'), null, { timeout: 6000 }).catch(() => {});
  check('logging out drops the personal view', (await page.locator('.leaderboard-list li.you').count()) === 0 && (await page.locator('.nav-progress').count()) === 0);

  // ── 8. Server asleep ─────────────────────────────────────
  await context.route(`${API}/**`, (route) => route.abort());
  await page.goto(`${APP}/unit/git-basics/learn`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.learn-error', { timeout: 10000 });
  check('with the server unreachable a lesson says so (not "Lesson not found")', (await page.locator('.learn-error').innerText()).includes("Couldn't load"));
  await context.unroute(`${API}/**`);
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForSelector('.learn-section', { timeout: 10000 }).catch(() => {});
  check('"Try again" loads the lesson once the server answers', (await page.locator('.learn-section').count()) > 0);

  const real = errors.filter((e) => !/_vercel|speed-insights|insights\/script|ERR_FAILED|Failed to load resource/.test(e));
  check('no JavaScript errors in the browser console', real.length === 0, real.slice(0, 3).join(' || '));
  const ignored = errors.length - real.length;
  for (const m of [...new Set(errors.filter((e) => !real.includes(e)).map((e) => e.slice(0, 110)))]) console.log('          ignored: ' + m);
  if (ignored) console.log(`        (${ignored} console messages ignored: failed network loads, incl. the deliberate offline test and Vercel-only analytics scripts)`);

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} browser checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => { console.error('WALK-THROUGH CRASHED:', err); process.exit(2); });
