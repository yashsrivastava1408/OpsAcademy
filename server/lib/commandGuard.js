/**
 * Command guard — a tripwire for obviously hostile terminal input.
 *
 * This is NOT the security boundary. Anything typed here can be hidden in a
 * script, an alias or an editor, so the container limits (no network, dropped
 * capabilities, pid/memory caps) are what actually contain a student. The
 * guard exists to stop casual abuse early, give the student a clear message,
 * and count strikes so repeat offenders get reaped.
 */

const RULES = [
  { id: 'fork_bomb', pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  { id: 'fork_bomb', pattern: /(\w+)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1/ },
  { id: 'root_delete', pattern: /\brm\s+(?:-[a-zA-Z]+\s+|--[a-z-]+\s+)*\/(?:\*|\s|$)/ },
  { id: 'root_delete', pattern: /--no-preserve-root/ },
  { id: 'disk_fill', pattern: /\bdd\b[^|;&]*\bif=\/dev\/(?:zero|urandom|random)\b(?![^|;&]*\bcount=)/ },
  { id: 'crypto_miner', pattern: /\b(?:xmrig|minerd|cpuminer|ethminer|nicehash)\b/i },
  { id: 'crypto_miner', pattern: /stratum\+(?:tcp|ssl):\/\//i },
  { id: 'reverse_shell', pattern: /\/dev\/(?:tcp|udp)\/\S+\/\d+/ },
  { id: 'reverse_shell', pattern: /\b(?:nc|ncat|netcat)\b[^|;&]*\s-[a-zA-Z]*e[a-zA-Z]*\s+\S*sh\b/ },
  { id: 'reverse_shell', pattern: /\bmkfifo\b.*\|\s*(?:nc|ncat|netcat)\b/ },
  { id: 'host_escape', pattern: /docker\.sock/ },
  { id: 'host_escape', pattern: /\bnsenter\b/ },
  { id: 'host_escape', pattern: /\/proc\/sysrq-trigger|\brelease_agent\b|\/sys\/fs\/cgroup\/[^\s]*notify_on_release/ },
  { id: 'host_escape', pattern: /\bmount\b[^|;&]*\s(?:-t\s+)?(?:proc|sysfs|cgroup2?)\b/ },
];

// 8+ characters: long enough to hide `rm -rf /`, short enough that ordinary words rarely decode to text.
const BASE64_TOKEN = /[A-Za-z0-9+/]{8,}={0,2}/g;
const HEX_ESCAPES = /(?:\\x[0-9a-fA-F]{2}){4,}/g;

function isPrintable(text) {
  return text.length > 0 && /^[\x09\x0a\x0d\x20-\x7e]+$/.test(text);
}

/**
 * Return the command plus any readable payloads hidden in base64 or \x hex,
 * so `echo <blob> | base64 -d | sh` is checked against the same rules.
 */
function deobfuscate(command) {
  const parts = [command];

  for (const token of command.match(BASE64_TOKEN) || []) {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    if (isPrintable(decoded)) parts.push(decoded);
  }

  for (const run of command.match(HEX_ESCAPES) || []) {
    const decoded = run.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (isPrintable(decoded)) parts.push(decoded);
  }

  return parts;
}

/**
 * @returns {{ blocked: boolean, rule?: string, deobfuscated?: boolean }}
 */
function check(command) {
  if (!command || !command.trim()) return { blocked: false };

  const candidates = deobfuscate(command);
  for (let i = 0; i < candidates.length; i += 1) {
    for (const rule of RULES) {
      if (rule.pattern.test(candidates[i])) {
        return { blocked: true, rule: rule.id, deobfuscated: i > 0 };
      }
    }
  }
  return { blocked: false };
}

/**
 * Rebuilds command lines from raw keystrokes so the gateway can see what is
 * about to run when Enter is pressed. It is approximate by design: history
 * recall, tab completion and cursor movement happen inside the shell and are
 * not visible here.
 */
class LineBuffer {
  constructor(maxLength = 4096) {
    this.maxLength = maxLength;
    this.line = '';
    this.escape = null; // null | 'start' | 'csi'
  }

  /**
   * @param {string} data raw input from the browser
   * @returns {Array<{data: string} | {line: string, terminator: string}>}
   *   pass-through chunks, interleaved with a `line` entry each time Enter is hit
   */
  push(data) {
    const out = [];
    let pending = '';

    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        if (pending) out.push({ data: pending });
        pending = '';
        out.push({ line: this.line, terminator: ch });
        this.line = '';
        this.escape = null;
        continue;
      }

      pending += ch;

      if (this.escape === 'start') {
        this.escape = ch === '[' || ch === 'O' ? 'csi' : null;
      } else if (this.escape === 'csi') {
        if (ch >= '@' && ch <= '~') this.escape = null;
      } else if (ch === '\x1b') {
        this.escape = 'start';
      } else if (ch === '\x7f' || ch === '\b') {
        this.line = this.line.slice(0, -1);
      } else if (ch === '\x03' || ch === '\x15') {
        this.line = '';
      } else if (ch >= ' ' && this.line.length < this.maxLength) {
        this.line += ch;
      }
    }

    if (pending) out.push({ data: pending });
    return out;
  }
}

module.exports = { RULES, check, deobfuscate, LineBuffer };
