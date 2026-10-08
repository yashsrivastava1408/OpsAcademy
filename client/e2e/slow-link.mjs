/**
 * Typing on a slow connection.
 *
 * Runs the same keystrokes twice in a real shell: once on a fast link and
 * once with 150 ms added in each direction (a 300 ms round trip, like a
 * gateway on another continent). Checks that local echo shows each key at
 * once on the slow link, stays off on the fast one, and that the two screens
 * end up identical: typos, tab completion, a hidden prompt, `less`, Ctrl+C.
 */
import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://localhost:4173';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`); };

/** On a failing run, keep a picture of where the browser ended up (see run.mjs). */
async function keepScreenshot(target, name) {
  if (!process.env.E2E_ARTIFACTS || !target) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(process.env.E2E_ARTIFACTS, { recursive: true });
  await target.screenshot({ path: `${process.env.E2E_ARTIFACTS}/${name}.png`, fullPage: true }).catch(() => {});
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    window.__delay = 0; // ms added in EACH direction
    window.WebSocket = function (...args) {
      const ws = new Native(...args);
      const send = ws.send.bind(ws);
      let sendChain = Promise.resolve();
      ws.send = (d) => { const wait = window.__delay; sendChain = sendChain.then(() => new Promise((r) => setTimeout(r, 0))); setTimeout(() => { if (ws.readyState === 1) send(d); }, wait); };
      let handler = null;
      Object.defineProperty(ws, 'onmessage', {
        set(fn) { handler = fn; },
        get() { return handler; },
      });
      ws.addEventListener('message', (event) => { const wait = window.__delay; setTimeout(() => handler && handler(event), wait); });
      return ws;
    };
    window.WebSocket.prototype = Native.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = Native[k];
    window.__screen = () => {
      const term = document.querySelector('.terminal-body > div').__xterm;
      const buffer = term.buffer.active;
      const lines = [];
      for (let i = 0; i < buffer.length; i += 1) lines.push(buffer.getLine(i).translateToString(true));
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      return lines;
    };
    // Type one key and time how long until it is on screen.
    window.__timeKey = (key) => new Promise((resolve) => {
      const term = document.querySelector('.terminal-body > div').__xterm;
      const before = window.__screen().join('\n');
      const t0 = performance.now();
      term.input(key);
      const poll = () => {
        if (window.__screen().join('\n') !== before) resolve(performance.now() - t0);
        else if (performance.now() - t0 > 3000) resolve(3000);
        else setTimeout(poll, 2);
      };
      poll();
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sleep = (ms) => page.waitForTimeout(ms);
  const type = async (text, gap = 60) => { for (const ch of text) { await page.evaluate((c) => document.querySelector('.terminal-body > div').__xterm.input(c), ch); await sleep(gap); } };
  const settle = async () => { // wait until the screen stops changing
    let last = ''; let same = 0;
    for (let i = 0; i < 80 && same < 6; i += 1) { await sleep(120); const now = (await page.evaluate(() => window.__screen())).join('\n'); same = now === last ? same + 1 : 0; last = now; }
  };
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  const session = async (delay) => {
    await page.goto(`${APP}/unit/linux-basics/practice`, { waitUntil: 'networkidle' });
    await page.evaluate((d) => { window.__delay = d; }, delay);
    // The terminal's web font changes the width of a character, and so the
    // number of columns. Have it loaded before the terminal is used, so both
    // sessions are measured with the same font.
    await page.evaluate(() => document.fonts.load("14px 'JetBrains Mono'").catch(() => {}));
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: /Start Lab/ }).first().click();
    await page.waitForSelector('.terminal-status.connected');
    await sleep(1200 + delay * 2);
    await page.locator('.terminal-body').click();

    // The shell must believe the same width the browser draws: a mismatch
    // makes long lines wrap in the wrong place.
    await type('echo cols-$(stty size | cut -d" " -f2)-end\r'); await settle();
    const shellCols = Number(((await page.evaluate(() => window.__screen())).join('').match(/cols-(\d+)-end/) || [])[1]);
    const drawnCols = await page.evaluate(() => document.querySelector('.terminal-body > div').__xterm.cols);

    // warm-up so the latency is known, then time single keys
    await type('echo warm', 90); await type('\r'); await settle();
    const times = [];
    for (const key of 'echo timing-test-abcdefgh') { times.push(await page.evaluate((k) => window.__timeKey(k), key)); await sleep(70); }
    await type('\r'); await settle();

    // a mix of everything a student does
    await type('echo hello-$((40+2))\r'); await settle();
    await type('ecx'); await type('\x7f'); await type('ho typo-fixed\r'); await settle();
    await type('mkdir zzdir && touch zzdir/afile.txt\r'); await settle();
    await type('cd zz'); await type('\t'); await sleep(400 + delay * 2); await type('\r'); await settle();
    await type('pwd\r'); await settle();
    await type('ls af'); await type('\t'); await sleep(400 + delay * 2); await type('\r'); await settle();
    await type('cd ..\r'); await settle();
    await type('read -s hidden; echo got-$hidden\r'); await settle();
    await type('s3cret'); await sleep(1200); await type('\r'); await settle();
    await type('seq 1 300 | less\r'); await settle();
    await type('jjj'); await sleep(300 + delay * 2); await type('q'); await settle();
    await type('echo after-less\r'); await settle();
    await type('echo a-fairly-long-line-to-go-past-the-middle-of-the-screen-0123456789-0123456789-0123456789-0123456789-0123456789\r'); await settle();
    await type('fast-burst-typing-with-no-gaps', 5); await type('\x03'); await settle();
    await type('echo done\r'); await settle();

    const screen = await page.evaluate(() => window.__screen());
    const stats = await page.evaluate(() => { const t = document.querySelector('.terminal-body > div').__typeahead; return { ...t.stats, latency: Math.round(t.latency), enabled: t.enabled, pending: t.pending }; });
    await page.getByRole('button', { name: 'Stop' }).click();
    await sleep(600 + delay);
    return { screen, stats, keyMs: median(times), times, shellCols, drawnCols };
  };

  const fast = await session(0);
  console.log(`        fast link: key visible after ${fast.keyMs.toFixed(0)} ms (median); guesses made: ${fast.stats.predicted}`);
  const slow = await session(150);
  console.log(`        slow link (300 ms round trip): key visible after ${slow.keyMs.toFixed(0)} ms (median), worst ${Math.max(...slow.times).toFixed(0)} ms; measured latency ${slow.stats.latency} ms`);
  console.log(`        guesses: ${slow.stats.predicted} made, ${slow.stats.confirmed} confirmed, ${slow.stats.rolledBack} taken back`);

  console.log(`        terminal width: fast session ${fast.drawnCols} columns drawn, shell believes ${fast.shellCols}; slow session ${slow.drawnCols} drawn, shell believes ${slow.shellCols}`);
  check('the shell and the browser agree on the terminal width (fast link)', fast.shellCols === fast.drawnCols, `shell ${fast.shellCols}, browser ${fast.drawnCols}`);
  check('the shell and the browser agree on the terminal width (slow link)', slow.shellCols === slow.drawnCols, `shell ${slow.shellCols}, browser ${slow.drawnCols}`);
  check('fast link: local echo stays off', fast.stats.predicted === 0 && !fast.stats.enabled);
  check('slow link: local echo turns itself on', slow.stats.enabled && slow.stats.predicted > 50);
  check('slow link: a typed key is on screen in under 30 ms instead of 300+', slow.keyMs < 30, `${slow.keyMs.toFixed(1)} ms`);
  check('slow link: nothing left as an unconfirmed guess', slow.stats.pending === '');
  // Compared as one stream of text with the line breaks removed: where a long
  // line wraps depends on the width of the terminal, which may differ by a
  // column or two between two page loads, and is checked on its own above.
  const flatten = (lines) => lines.join('\u0001')
    .replace(/sandboxes\/[0-9a-f\u0001]+\/home/g, 'sandboxes/ID/home')
    .replace(/cols-\d+-end/g, 'cols-N-end')
    .split('\u0001').map((l) => l.trimEnd());
  const a = flatten(fast.screen); const b = flatten(slow.screen);
  const stream = (lines) => lines.join('').replace(/\s+/g, '');
  const same = stream(a) === stream(b);
  let firstDiff = -1;
  if (!same) for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) { firstDiff = i; break; }
  check('slow link ends with exactly the same screen text as the fast link', same, same ? `${stream(a).length} characters identical` : `line ${firstDiff}: fast="${a[firstDiff]}" slow="${b[firstDiff]}"`);
  const text = b.join('\n');
  check('commands ran correctly on the slow link', ['hello-42', 'typo-fixed', 'got-s3cret', 'after-less', 'done'].every((t) => text.includes(t)) && /zzdir$/m.test(text) && text.includes('afile.txt'));
  check('the hidden input is not left on screen', !/^s3cret/m.test(text) && !text.includes('hidden; echo got-$hiddens3cret'));
  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
  if (firstDiff !== -1) { console.log('--- fast'); console.log(a.slice(Math.max(0, firstDiff - 3), firstDiff + 4).join('\n')); console.log('--- slow'); console.log(b.slice(Math.max(0, firstDiff - 3), firstDiff + 4).join('\n')); }
  if (results.includes(false)) await keepScreenshot(page, 'slow-link');
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} slow-link checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('LATENCY TEST CRASHED', e); process.exit(2); });
