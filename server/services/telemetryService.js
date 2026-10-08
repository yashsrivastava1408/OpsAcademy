/**
 * Telemetry Service — a snapshot of what is inside a sandbox
 *
 * Lists the student's files, running processes and listening ports by
 * running read-only commands in the sandbox. Shown in the inspector panel
 * and sent to the AI mentor as ground truth.
 */

const { getManager } = require('./sandboxManager');

const HOME = '/home/student';
const MAX_FILES = 200;
const MAX_PROCESSES = 15;
const MAX_DEPTH = 4;

function parseFiles(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_FILES)
    .map((line) => {
      // `find -exec ls -ld` style is not portable; lines are "<d|f> <path>".
      const type = line[0] === 'd' ? 'directory' : 'file';
      const fullPath = line.slice(2);
      const relPath = fullPath.startsWith(`${HOME}/`) ? fullPath.slice(HOME.length + 1) : fullPath;
      const parts = relPath.split('/');
      return { name: parts[parts.length - 1], path: relPath, type, depth: parts.length - 1 };
    })
    .filter((entry) => entry.path && entry.path !== HOME);
}

function parseProcesses(raw) {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.slice(1, MAX_PROCESSES + 1).map((line) => {
    const parts = line.split(/\s+/);
    return { pid: parts[0], user: parts[1], command: parts.slice(2).join(' ') };
  });
}

function parsePorts(raw) {
  const ports = new Set();
  for (const line of raw.split('\n')) {
    if (!/LISTEN/i.test(line)) continue;
    const match = line.match(/[:.](\d{2,5})\s/);
    if (match) ports.add(Number(match[1]));
  }
  return [...ports].sort((a, b) => a - b);
}

// One command gathers everything, with a marker line before each part. Three
// separate commands meant three `docker exec` calls per student on every
// poll, which is what slowed the gateway down under a classroom of load.
const SECTION = '@@opsacademy-section@@';
const SNAPSHOT_COMMAND = [
  `echo '${SECTION} files'`,
  // Two passes so directories and files are told apart without parsing `ls`.
  `find ${HOME} -mindepth 1 -maxdepth ${MAX_DEPTH} -not -path '*/.*' -type d | sed 's/^/d /'`,
  `find ${HOME} -mindepth 1 -maxdepth ${MAX_DEPTH} -not -path '*/.*' -not -type d | sed 's/^/f /'`,
  `echo '${SECTION} processes'`,
  'ps -o pid,user,args 2>/dev/null || ps',
  `echo '${SECTION} ports'`,
  'netstat -tln 2>/dev/null || ss -tln 2>/dev/null',
].join('; ');

/** Split the snapshot output into its named parts. A part that is missing comes back empty. */
function splitSections(raw) {
  const sections = { files: '', processes: '', ports: '' };
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith(SECTION)) {
      current = line.slice(SECTION.length).trim();
    } else if (current in sections) {
      sections[current] += `${line}\n`;
    }
  }
  return sections;
}

/**
 * @param {{ touch?: boolean }} [options] touch: false for polling, so looking
 *   at the inspector is not counted as the student using the sandbox.
 */
async function capture(sessionId, { touch = true, manager = getManager() } = {}) {
  let raw = '';
  try {
    raw = (await manager.exec(sessionId, SNAPSHOT_COMMAND, { touch })).stdout || '';
  } catch {
    // The sandbox has just gone away: an empty snapshot, not an error.
  }
  const { files: filesRaw, processes: psRaw, ports: portsRaw } = splitSections(raw);

  const fileTree = parseFiles(filesRaw).sort((x, y) => x.path.localeCompare(y.path));

  return {
    sessionId,
    fileTree,
    maxDepth: MAX_DEPTH,
    // True when the listing hit the cap, so absence from it proves nothing.
    truncated: filesRaw.split('\n').filter(Boolean).length > MAX_FILES,
    processes: parseProcesses(psRaw),
    ports: parsePorts(portsRaw),
    timestamp: new Date().toISOString(),
  };
}

module.exports = { capture, parseFiles, parseProcesses, parsePorts, splitSections, SNAPSHOT_COMMAND };
