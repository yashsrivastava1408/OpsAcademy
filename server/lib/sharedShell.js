/**
 * One interactive shell that several connections can attach to, one after another or together.
 *
 * A container keeps its shell running when a browser disconnects; the next connection attaches to the same
 * shell and is shown the recent output first, so a dropped network or a reloaded page resumes where the
 * student was instead of starting a fresh shell. `close()` on an attachment only detaches it: the shell
 * ends when its stream ends (the student types `exit`) or when the sandbox is destroyed.
 */
const { StringDecoder } = require('string_decoder');

const SCROLLBACK_CHARS = 16 * 1024;

class SharedShell {
  /**
   * @param {{ stream: import('stream').Duplex, resize?: (cols: number, rows: number) => void, scrollbackChars?: number }} options
   */
  constructor({ stream, resize = () => {}, scrollbackChars = SCROLLBACK_CHARS }) {
    this.stream = stream;
    this.resizeFn = resize;
    this.scrollbackChars = scrollbackChars;
    this.scrollback = '';
    this.ended = false;
    this.dataListeners = new Set();
    this.closeListeners = new Set();

    // A chunk can end in the middle of a multi-byte character; the decoder holds the tail until the rest arrives.
    const decoder = new StringDecoder('utf8');
    stream.on('data', (chunk) => {
      const text = decoder.write(chunk);
      if (!text) return;
      this.scrollback = (this.scrollback + text).slice(-this.scrollbackChars);
      for (const listener of this.dataListeners) listener(text);
    });
    const end = () => {
      if (this.ended) return;
      this.ended = true;
      for (const listener of this.closeListeners) listener();
      this.closeListeners.clear();
      this.dataListeners.clear();
    };
    stream.on('end', end);
    stream.on('close', end);
    stream.on('error', end);
  }

  /** A terminal object (the interface the engines return from attach). */
  attach() {
    const mine = { data: null, close: null };
    return {
      onData: (callback) => {
        mine.data = callback;
        if (this.scrollback) callback(this.scrollback);
        this.dataListeners.add(callback);
      },
      /** Called when the shell itself ends (not when this attachment is closed). */
      onClose: (callback) => {
        mine.close = callback;
        if (this.ended) callback();
        else this.closeListeners.add(callback);
      },
      write: (data) => {
        if (!this.ended && !this.stream.destroyed) this.stream.write(data);
      },
      resize: (cols, rows) => {
        if (!this.ended) this.resizeFn(cols, rows);
      },
      close: () => {
        if (mine.data) this.dataListeners.delete(mine.data);
        if (mine.close) this.closeListeners.delete(mine.close);
      },
    };
  }

  clearScrollback() {
    this.scrollback = '';
  }

  /** End the shell for good (the sandbox is going away). */
  destroy() {
    if (!this.stream.destroyed) this.stream.destroy();
  }
}

module.exports = { SharedShell, SCROLLBACK_CHARS };
