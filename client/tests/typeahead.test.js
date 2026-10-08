import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTypeahead } from '../src/components/Terminal/typeahead.js';

/**
 * A one-line model of a terminal: enough to check that what ends up on
 * screen is exactly what the server sent, whatever was predicted on the way.
 */
function harness({ cols = 80, prompt = '$ ' } = {}) {
  const screen = { line: prompt, cursor: prompt.length, alternate: false, busy: false };
  let time = 0;
  const timers = new Map();
  let nextTimer = 1;

  function apply(text) {
    let i = 0;
    while (i < text.length) {
      const erase = /^\x1b\[(\d+)D\x1b\[K/.exec(text.slice(i));
      if (erase) {
        screen.cursor -= Number(erase[1]);
        screen.line = screen.line.slice(0, screen.cursor);
        i += erase[0].length;
      } else if (text[i] === '\b') {
        screen.cursor -= 1;
        i += 1;
      } else if (text[i] === '\r') {
        screen.cursor = 0;
        i += 1;
      } else if (text[i] === '\n') {
        screen.line = '';
        screen.cursor = 0;
        i += 1;
      } else {
        screen.line = screen.line.slice(0, screen.cursor) + text[i] + screen.line.slice(screen.cursor + 1);
        screen.cursor += 1;
        i += 1;
      }
    }
  }

  const typeahead = createTypeahead({
    write: apply,
    getState: () => ({ cols, cursorX: screen.cursor, lineLength: screen.line.trimEnd().length, alternate: screen.alternate, busy: screen.busy }),
    now: () => time,
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, at: time + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });

  return {
    screen,
    typeahead,
    advance(ms) {
      time += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    type(data) { typeahead.input(data); },
    /** The server answers: write whatever typeahead says to write. */
    server(data) { apply(typeahead.output(data)); },
    /** Type a key and get its plain echo back after `rtt` ms, to teach it the latency. */
    warmUp(rtt, keys = 'abc') {
      for (const key of keys) {
        this.type(key);
        this.advance(rtt);
        this.server(key);
      }
    },
  };
}

test('on a fast connection nothing is predicted', () => {
  const h = harness();
  h.warmUp(8);
  assert.equal(h.typeahead.enabled, false);
  h.type('x');
  assert.equal(h.screen.line, '$ abc');
  h.server('x');
  assert.equal(h.screen.line, '$ abcx');
  assert.equal(h.typeahead.stats.predicted, 0);
});

test('on a slow connection a typed character shows at once and the echo confirms it', () => {
  const h = harness();
  h.warmUp(300);
  assert.equal(h.typeahead.enabled, true);
  const confirmedBefore = h.typeahead.stats.confirmed;

  h.type('l');
  h.type('s');
  assert.equal(h.screen.line, '$ abcls', 'visible before the server answered');
  assert.equal(h.typeahead.pending, 'ls');

  h.advance(300);
  h.server('l');
  h.server('s');
  assert.equal(h.screen.line, '$ abcls', 'not drawn twice');
  assert.equal(h.typeahead.pending, '');
  assert.equal(h.typeahead.stats.confirmed - confirmedBefore, 2);
});

test('a shell that redraws the previous character with the new one still confirms (zsh)', () => {
  const h = harness();
  h.warmUp(200);
  for (const key of 'echo') h.type(key);
  assert.equal(h.screen.line, '$ abcecho');
  h.advance(200);
  h.server('e');
  h.server('\bec'); // step back over "e", write "ec"
  h.server('h');
  h.server('o');
  assert.equal(h.screen.line, '$ abcecho');
  assert.equal(h.typeahead.pending, '');
  assert.equal(h.typeahead.stats.rolledBack, 0);
});

test('one slow answer does not switch local echo on', () => {
  const h = harness();
  h.warmUp(8, 'abcd');
  h.type('e');
  h.advance(900); // the shell was busy once
  h.server('e');
  h.warmUp(8, 'f');
  assert.equal(h.typeahead.enabled, false);
});

test('echoes that arrive joined in one chunk confirm several characters', () => {
  const h = harness();
  h.warmUp(200);
  for (const key of 'echo') h.type(key);
  h.advance(200);
  h.server('ec');
  assert.equal(h.typeahead.pending, 'ho');
  h.server('ho');
  assert.equal(h.screen.line, '$ abcecho');
  assert.equal(h.typeahead.pending, '');
});

test('when the server sends something else, the guess is erased and the server wins', () => {
  const h = harness();
  h.warmUp(200);
  h.type('x');
  h.type('y');
  assert.equal(h.screen.line, '$ abcxy');
  h.advance(200);
  // The shell did not echo: it printed something of its own.
  h.server('\r\nbash: nope\r\n$ ');
  assert.equal(h.screen.line, '$ ');
  assert.equal(h.typeahead.pending, '');

  // After a wrong guess it stays quiet until the next Enter.
  h.type('z');
  assert.equal(h.screen.line, '$ ', 'no new guess on the same line');
  h.server('z');
  assert.equal(h.screen.line, '$ z');
  h.type('\r');
  h.server('\r\n$ ');
  h.type('q');
  assert.equal(h.screen.line, '$ q', 'guessing again on the new line');
});

test('an echo followed by more output keeps the screen exactly as the server sent it', () => {
  const h = harness();
  h.warmUp(200);
  h.type('c');
  h.type('a');
  h.advance(200);
  // Echo of "ca" and then a completion, all in one chunk.
  h.server('cat ');
  assert.equal(h.screen.line, '$ abccat ');
  assert.equal(h.typeahead.pending, '');
});

test('a prompt that does not echo (a hidden input) has its guess taken back', () => {
  const h = harness({ prompt: 'Password: ' });
  h.screen.line = '$ ';
  h.screen.cursor = 2;
  h.warmUp(200);
  h.type('\r');
  h.server('\r\nPassword: ');
  h.type('s');
  h.type('3');
  assert.equal(h.screen.line, 'Password: s3');
  h.advance(900);
  assert.equal(h.screen.line, 'Password: ', 'erased when no echo came');
  h.type('c');
  assert.equal(h.screen.line, 'Password: ', 'and nothing more is shown for that prompt');
});

test('backspace removes a character that is still only a guess', () => {
  const h = harness();
  h.warmUp(200);
  h.type('l');
  h.type('x');
  h.type('\x7f');
  assert.equal(h.screen.line.trimEnd(), '$ abcl');
  assert.equal(h.typeahead.pending, 'l');

  // The server then echoes all three keystrokes in order.
  h.advance(200);
  h.server('l');
  h.server('x');
  h.server('\b \b');
  assert.equal(h.screen.line.trimEnd(), '$ abcl');
});

test('nothing is guessed inside a full-screen program, mid-line, or while output is still arriving', () => {
  const h = harness();
  h.warmUp(200);

  h.screen.alternate = true;
  h.type('j');
  assert.equal(h.typeahead.pending, '');
  h.server('');
  h.screen.alternate = false;

  h.screen.busy = true;
  h.type('k');
  assert.equal(h.typeahead.pending, '');
  h.screen.busy = false;

  h.screen.cursor = 3; // the cursor was moved back into the line
  h.type('m');
  assert.equal(h.typeahead.pending, '');
});

test('after Tab or an arrow key it waits for the shell before guessing again', () => {
  const h = harness();
  h.warmUp(200);
  h.type('\t');
  h.type('x');
  assert.equal(h.typeahead.pending, '', 'the shell may be about to insert a completion');
  h.server('def ');
  h.server('x');
  assert.equal(h.screen.line, '$ abcdef x');
  h.type('y');
  assert.equal(h.typeahead.pending, 'y');
});

test('guesses stop before the right edge so a line never wraps on a guess', () => {
  const h = harness({ cols: 12 });
  h.warmUp(200, 'ab');
  for (const key of 'cdefghijklmnop') h.type(key);
  assert.ok(h.screen.cursor < 11, `cursor at ${h.screen.cursor}`);
  assert.ok(h.typeahead.pending.length < 14);
});

test('whatever is typed and however the echoes are chunked, the screen ends as the server left it', () => {
  // Random typing against a plain echoing shell with random chunking and a few surprises.
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let round = 0; round < 200; round += 1) {
    const h = harness({ cols: 60 });
    h.warmUp(150 + Math.floor(random() * 300), 'ab');
    let truth = h.screen.line; // what a terminal with no local echo would show
    let queue = '';

    const flush = () => {
      while (queue) {
        const size = 1 + Math.floor(random() * 3);
        const chunk = queue.slice(0, size);
        queue = queue.slice(size);
        h.server(chunk);
      }
    };

    for (let i = 0; i < 25; i += 1) {
      const roll = random();
      if (roll < 0.75) {
        const key = 'abcdefghijklmnopqrstuvwxyz -/.'[Math.floor(random() * 30)];
        h.type(key);
        queue += key;
        truth += key;
      } else if (roll < 0.85 && truth.length > 2) {
        h.type('\x7f');
        queue += '\b \b';
        truth = truth.slice(0, -1);
      } else if (roll < 0.9) {
        // The shell says something nobody predicted.
        h.type('\t');
        queue += 'XY';
        truth += 'XY';
      }
      if (random() < 0.4) {
        h.advance(100);
        flush();
      }
    }
    h.advance(100);
    flush();
    assert.equal(h.screen.line.trimEnd(), truth.trimEnd(), `round ${round}`);
    assert.equal(h.typeahead.pending, '');
  }
});
