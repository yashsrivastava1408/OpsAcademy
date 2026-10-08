#!/usr/bin/env node
/**
 * Live check of the Docker sandbox against a real Docker daemon.
 *
 * Starts sandboxes exactly as the gateway does and tries to break each
 * restriction from inside. Run it after building the sandbox image:
 *
 *   docker build -t opsacademy-sandbox:latest ../sandbox-image
 *   node scripts/docker-check.js
 *
 * Exits 1 if any restriction does not hold.
 */

process.env.SANDBOX_MODE = 'docker';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';

const config = require('../config');
const docker = require('../services/dockerService');
const { createManager } = require('../services/sandboxManager');

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const sleep = (t) => new Promise((resolve) => setTimeout(resolve, t));

async function main() {
  console.log(`\nDocker sandbox check — image ${config.sandbox.dockerImage}, network '${config.sandbox.dockerNetworkMode}'\n`);
  await docker.cleanupOrphans();

  const id = `check${Date.now().toString(36)}`;
  let start = process.hrtime.bigint();
  await docker.create(id, { labId: 'check' });
  const coldStartMs = ms(start);
  const run = async (command, options) => docker.exec(id, command, options);
  const out = async (command) => (await run(command)).stdout.trim();

  // ── Identity and privilege ──────────────────────────────────
  check('runs as the unprivileged student user', (await out('id -u')) === '1000' && (await out('whoami')) === 'student');
  const caps = await out("grep -E 'Cap(Eff|Prm|Bnd)' /proc/self/status | awk '{print $2}' | sort -u");
  check('holds no Linux capabilities', caps === '0000000000000000', `effective/permitted/bounding = ${caps}`);
  check('cannot gain privileges (no_new_privs set)', (await out("grep NoNewPrivs /proc/self/status | awk '{print $2}'")) === '1');
  check('no sudo and no setuid binaries', (await run('command -v sudo')).exitCode !== 0 && (await out('find / -xdev -perm -4000 -type f 2>/dev/null | wc -l')) === '0');
  check('Docker socket is not present', (await run('test -e /var/run/docker.sock')).exitCode !== 0);

  // ── Filesystem ──────────────────────────────────────────────
  check('root filesystem is read-only', (await run('touch /etc/x /usr/bin/x /x 2>/dev/null')).exitCode !== 0);
  check('home directory is writable', (await run('echo hi > /home/student/a.txt && cat /home/student/a.txt')).stdout.trim() === 'hi');
  const script = await run("printf '#!/bin/bash\\necho ran-$((1+1))\\n' > /home/student/s.sh && chmod +x /home/student/s.sh && /home/student/s.sh");
  check('students can run their own scripts from home', script.stdout.trim() === 'ran-2', script.stderr.trim());
  const fill = await run('dd if=/dev/zero of=/home/student/big bs=1M count=200 2>&1; ls -l /home/student/big | awk \'{print $5}\'', { timeoutMs: 20000 });
  const written = Number(fill.stdout.trim().split('\n').pop());
  check('home directory is capped in size', written <= config.sandbox.homeSizeMB * 1024 * 1024, `tried 200 MB, ${Math.round(written / 1048576)} MB written, cap ${config.sandbox.homeSizeMB} MB`);
  await run('rm -f /home/student/big');
  const noexec = await run('cp /bin/busybox /tmp/bb 2>/dev/null || cp /bin/ls /tmp/bb; chmod +x /tmp/bb; /tmp/bb --help >/dev/null 2>&1');
  check('/tmp does not allow executing files', noexec.exitCode !== 0);

  // ── Network ─────────────────────────────────────────────────
  if (config.sandbox.dockerNetworkMode === 'none') {
    // Tunnel placeholders (gre0, sit0, ...) can exist with no address; what
    // matters is that nothing but loopback has one.
    const addressed = await out("ip -o addr show | awk '{print $2}' | sort -u | tr '\\n' ' '");
    check('no network interface has an address besides loopback', addressed.trim() === 'lo', addressed.trim());
    check('cannot reach the internet', (await run('curl -s -m 3 https://example.com >/dev/null 2>&1', { timeoutMs: 8000 })).exitCode !== 0);
  }

  // ── Resource limits ─────────────────────────────────────────
  // Each fork is tried in a subshell (a failed fork would abort the main
  // shell) and counted with built-ins only: at the limit, `ps` cannot start.
  const forks = await run(
    'n=0; f=0; i=0; while [ $i -lt 400 ]; do i=$((i+1)); if (sleep 8 &) 2>/dev/null; then n=$((n+1)); else f=$((f+1)); fi; done; set -- /proc/[0-9]*; echo "$n $f $#"',
    { timeoutMs: 20000 }
  );
  const [startedForks, failedForks, processes] = forks.stdout.trim().split('\n').pop().split(' ').map(Number);
  check(
    'process count is capped (fork bomb contained)',
    failedForks > 0 && processes <= config.sandbox.maxPids,
    `400 forks tried: ${startedForks} started, ${failedForks} refused, ${processes} processes, cap ${config.sandbox.maxPids}`
  );
  // The container is now at its process limit, so a clean-up command may not
  // be able to start at all (it cannot on GitHub's runners). The sleeps end on
  // their own; wait until a new process can run before testing anything else,
  // or every later check would fail for the wrong reason.
  await run('pkill sleep');
  let recovered = false;
  for (let attempt = 0; attempt < 60 && !recovered; attempt += 1) {
    recovered = (await run('echo recovered')).stdout.includes('recovered');
    if (!recovered) await sleep(500);
  }
  check('the sandbox is usable again once the fork bomb\'s processes end', recovered);

  const memory = await run(`python3 -c "x = bytearray(${config.sandbox.maxMemoryMB * 2} * 1024 * 1024); print('allocated')"`, { timeoutMs: 20000 });
  // Exit 137 is a kill by the kernel; a Python MemoryError exits 1. Anything
  // else means the program never ran, which would prove nothing.
  check(
    'memory is capped (over-allocation is killed)',
    !memory.stdout.includes('allocated') && [137, 1].includes(memory.exitCode),
    `tried ${config.sandbox.maxMemoryMB * 2} MB, cap ${config.sandbox.maxMemoryMB} MB, exit ${memory.exitCode}`
  );
  check('sandbox survives the out-of-memory kill', docker.isAlive(id) && (await out('echo ok')) === 'ok');

  start = process.hrtime.bigint();
  const hung = await run('sleep 30', { timeoutMs: 1000 });
  check('a hanging check is cut off by the exec timeout', hung.exitCode === 124 && ms(start) < 3000);

  // ── Terminal ────────────────────────────────────────────────
  start = process.hrtime.bigint();
  const terminal = await docker.attach(id);
  let output = '';
  let firstByteMs = null;
  terminal.onData((data) => {
    if (firstByteMs === null) firstByteMs = ms(start);
    output += data;
  });
  terminal.resize(100, 30);
  await sleep(600);
  const echoStart = process.hrtime.bigint();
  terminal.write('echo sum-$((40+2))\r');
  while (!output.includes('sum-42') && ms(echoStart) < 5000) await sleep(2);
  const echoMs = ms(echoStart);
  check('interactive terminal runs commands', output.includes('sum-42'));
  check('terminal shows the lab prompt, not the host name', output.includes('student@opsacademy'));
  terminal.write('stty size\r');
  await sleep(400);
  check('terminal resize is applied', output.includes('30 100'));
  terminal.close();

  // ── Reset and teardown ──────────────────────────────────────
  await run('mkdir -p /home/student/a/b && touch /home/student/a/b/c /home/student/.hidden');
  await docker.reset(id);
  check('reset wipes the home directory', (await out('ls -A /home/student')) === '');

  const info = docker.info(id);
  await docker.destroy(id);
  const left = await docker.exec(id, 'true').then(() => true, () => false);
  check('destroy removes the container', !left && info.containerId.length === 12);

  // ── Manager with a pre-warmed pool ──────────────────────────
  const manager = createManager({ engine: docker, pool: { enabled: true, size: 2 } });
  await manager.init();
  start = process.hrtime.bigint();
  const session = await manager.createSession('check-user', 'linux-basics');
  const claimMs = ms(start);
  check('a pooled container is claimed and usable by session id', session.fromPool && (await manager.exec(session.sessionId, 'echo ok')).stdout.trim() === 'ok');
  await manager.shutdown();
  const orphans = await docker.cleanupOrphans();
  check('shutdown leaves no containers behind', orphans.containers === 0 && orphans.networks === 0, JSON.stringify(orphans));

  console.log('\nMeasured on this machine:');
  console.log(`  cold start (create + start container)   ${coldStartMs.toFixed(0)} ms`);
  console.log(`  claim from pre-warmed pool               ${claimMs.toFixed(2)} ms`);
  console.log(`  terminal attach to first output          ${firstByteMs === null ? 'n/a' : `${firstByteMs.toFixed(0)} ms`}`);
  console.log(`  keystroke to echoed output               ${echoMs.toFixed(1)} ms`);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`\nDocker check aborted: ${err.message}`);
  if (/ENOENT|ECONNREFUSED|socket/.test(err.message)) console.error('Is the Docker daemon running?');
  if (/No such image/.test(err.message)) console.error('Build the image first: docker build -t opsacademy-sandbox:latest ../sandbox-image');
  await docker.cleanupOrphans().catch(() => {});
  process.exit(1);
});
