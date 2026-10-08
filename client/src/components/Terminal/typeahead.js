/**
 * Local echo for a terminal on a slow connection.
 *
 * Normally a typed character appears only after it has travelled to the
 * sandbox and back. When that round trip is slow, this shows the character
 * straight away and lets the server's answer confirm it.
 *
 * It can never leave the screen wrong: whenever the server sends anything
 * other than exactly the characters that were predicted, the predictions are
 * erased and the server's output is written as it is. A wrong guess costs a
 * flicker, nothing more. Guesses are only made where they are almost always
 * right: plain characters typed at the end of a line, outside full-screen
 * programs, and never on a fast connection.
 */

const PRINTABLE = /^[\x20-\x7e]$/;
const BACKSPACE = '\x7f';

// Round trips slower than this are worth hiding; faster ones are left alone.
const ENABLE_ABOVE_MS = 50;
const DISABLE_BELOW_MS = 25;
// The latency is the median of the last few echoes, so one slow answer
// (the shell was busy) does not switch local echo on or off.
const LATENCY_SAMPLES = 5;
// How many already-echoed characters are remembered. Some shells redraw the
// previous character with the new one (zsh sends "\bec" for a typed "c").
const RECENT_CHARS = 16;
// A keystroke that gets no answer for this long has no echo (a hidden prompt).
const MIN_ROLLBACK_MS = 600;
const MAX_TRACKED_KEYS = 32;
const STALE_KEY_MS = 5000;

/**
 * @param {object} deps
 * @param {(text: string) => void} deps.write        write to the terminal
 * @param {() => { cols: number, cursorX: number, lineLength: number, alternate: boolean, busy: boolean }} deps.getState
 *        cursor column, length of the cursor's line, whether a full-screen
 *        program is showing, and whether writes are still being processed
 * @param {() => number} [deps.now]
 * @param {(fn: () => void, ms: number) => any} [deps.setTimer]
 * @param {(id: any) => void} [deps.clearTimer]
 */
export function createTypeahead({ write, getState, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let predicted = ''; // shown locally, not yet echoed by the server
  let startX = 0; // column where the first outstanding prediction was drawn
  let recent = ''; // the last characters the server echoed, left of the cursor
  let latency = null; // typical round trip in ms
  let samples = [];
  let enabled = false;
  let suppressed = false; // a guess was wrong: stop until the next Enter
  let awaitingReply = false; // a key the shell answers in its own way was sent
  let keyTimes = [];
  let timer = null;
  const stats = { predicted: 0, confirmed: 0, rolledBack: 0 };

  function eraseSequence(count) {
    return count > 0 ? `\x1b[${count}D\x1b[K` : '';
  }

  function disarm() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function arm() {
    disarm();
    timer = setTimer(() => {
      timer = null;
      if (!predicted) return;
      // Nothing came back: the program is not echoing, so take the guess away.
      write(eraseSequence(predicted.length));
      stats.rolledBack += predicted.length;
      predicted = '';
      recent = '';
      suppressed = true;
    }, Math.max(MIN_ROLLBACK_MS, (latency || 0) * 4));
  }

  function measure() {
    const time = now();
    while (keyTimes.length > 0 && time - keyTimes[0] > STALE_KEY_MS) keyTimes.shift();
    const sentAt = keyTimes.shift();
    if (sentAt === undefined) return;
    samples.push(time - sentAt);
    if (samples.length > LATENCY_SAMPLES) samples.shift();
    if (samples.length < 3) return;
    latency = samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    if (latency > ENABLE_ABOVE_MS) enabled = true;
    else if (latency < DISABLE_BELOW_MS) enabled = false;
  }

  /**
   * Does this chunk do nothing but echo predicted characters? It may step
   * back over characters already on screen and write them again.
   * @returns {number} how many predictions it confirms, or -1 if it does anything else
   */
  function confirmedBy(data) {
    const known = recent + predicted;
    let position = recent.length;
    for (const ch of data) {
      if (ch === '\b') {
        position -= 1;
        if (position < 0) return -1;
      } else if (position < known.length && known[position] === ch) {
        position += 1;
      } else {
        return -1;
      }
    }
    return position - recent.length;
  }

  /** Call with everything the user types, before it is sent to the server. */
  function input(data) {
    // Only plain characters are timed: their echo comes straight back, while
    // Enter is answered when the command finishes.
    if (PRINTABLE.test(data)) {
      keyTimes.push(now());
      if (keyTimes.length > MAX_TRACKED_KEYS) keyTimes.shift();
    } else {
      keyTimes = [];
    }

    if (data === '\r') {
      suppressed = false;
      awaitingReply = false;
      recent = '';
      return;
    }

    if (data === BACKSPACE && predicted) {
      predicted = predicted.slice(0, -1);
      write('\b \b');
      if (predicted) arm();
      else disarm();
      return;
    }

    if (!PRINTABLE.test(data)) {
      // Tab, arrows, Ctrl keys, pastes: the shell decides what these do.
      awaitingReply = true;
      return;
    }

    if (!enabled || suppressed || awaitingReply) return;

    const state = getState();
    if (state.alternate) return;
    if (!predicted) {
      // Only start from a settled screen, with the cursor at the end of its line.
      if (state.busy || state.lineLength > state.cursorX) return;
      startX = state.cursorX;
    }
    // Stay clear of the right edge, where the line would wrap.
    if (startX + predicted.length + 1 >= state.cols - 1) return;

    predicted += data;
    stats.predicted += 1;
    write(data);
    arm();
  }

  /**
   * Call with each chunk from the server.
   * @returns {string} what to write to the terminal for it (may be empty)
   */
  function output(data) {
    measure();
    awaitingReply = false;

    if (!predicted) {
      // Keep track of plain echoes; anything else moves the cursor in ways not followed here.
      recent = /^[\x20-\x7e]+$/.test(data) ? (recent + data).slice(-RECENT_CHARS) : '';
      return data;
    }

    const confirmed = confirmedBy(data);
    if (confirmed >= 0) {
      // Exactly what was predicted: it is already on screen.
      stats.confirmed += confirmed;
      recent = (recent + predicted.slice(0, confirmed)).slice(-RECENT_CHARS);
      predicted = predicted.slice(confirmed);
      startX += confirmed;
      if (predicted) arm();
      else disarm();
      return '';
    }

    // Anything else: remove every guess and show what the server really sent.
    const erase = eraseSequence(predicted.length);
    stats.rolledBack += predicted.length;
    // A chunk that starts with the echo and then goes on (a completion, the
    // command's output) is normal; one that does not start with it means the
    // program is not echoing, so stop guessing on this line.
    if (data[0] !== predicted[0]) suppressed = true;
    predicted = '';
    recent = '';
    disarm();
    return erase + data;
  }

  /** Forget everything (a new connection). */
  function reset() {
    disarm();
    predicted = '';
    recent = '';
    suppressed = false;
    awaitingReply = false;
    keyTimes = [];
    samples = [];
    latency = null;
    enabled = false;
  }

  return {
    input,
    output,
    reset,
    get latency() { return latency; },
    get enabled() { return enabled; },
    get pending() { return predicted; },
    stats,
  };
}
