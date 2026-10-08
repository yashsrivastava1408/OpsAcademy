/**
 * Runs real shells through node-pty. These are the tests that prove a lab
 * can actually be done and verified end to end in PTY mode.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const pty = require('../services/ptyService');
const { createManager } = require('../services/sandboxManager');
const telemetryService = require('../services/telemetryService');
const { waitFor } = require('./helpers');

const ids = [];
function newId() {
  const id = `test-${Date.now()}-${ids.length}`;
  ids.push(id);
  return id;
}

afterEach(async () => {
  while (ids.length) await pty.destroy(ids.pop());
});

afterAll(() => {
  fs.rmSync(config.sandbox.sandboxesDir, { recursive: true, force: true });
});

test('exec runs in the sandbox home and reports exit codes', async () => {
  const id = newId();
  await pty.create(id);
  expect(await pty.exec(id, 'echo hi && exit 0')).toMatchObject({ exitCode: 0, stdout: 'hi\n' });
  expect((await pty.exec(id, 'exit 3')).exitCode).toBe(3);
  expect((await pty.exec(id, 'echo oops >&2')).stderr).toBe('oops\n');
});

test('labs written for /home/student work against the per-session directory', async () => {
  const id = newId();
  await pty.create(id);

  expect((await pty.exec(id, 'pwd')).stdout.trim()).toBe('/home/student');
  await pty.exec(id, 'mkdir -p /home/student/webapp/src && touch /home/student/webapp/src/index.js');

  const onDisk = path.join(config.sandbox.sandboxesDir, id, 'home', 'student', 'webapp', 'src', 'index.js');
  expect(fs.existsSync(onDisk)).toBe(true);
  expect((await pty.exec(id, 'test -f /home/student/webapp/src/index.js && echo PASS || echo FAIL')).stdout.trim()).toBe('PASS');
});

test('the shell does not inherit the gateway environment', async () => {
  process.env.OPS_TEST_SECRET = 'do-not-leak';
  const id = newId();
  await pty.create(id);
  const terminal = await pty.attach(id);
  let output = '';
  terminal.onData((data) => { output += data; });

  terminal.write('echo "secret=[$OPS_TEST_SECRET] jwt=[$JWT_SECRET] user=[$USER]"\r');
  await waitFor(() => output.includes('user=[student]'));

  expect(output).toContain('secret=[] jwt=[]');
  expect(output).not.toContain('do-not-leak');
  terminal.close();
  delete process.env.OPS_TEST_SECRET;
});

test('an attached terminal runs commands and sees their output', async () => {
  const id = newId();
  await pty.create(id);
  const terminal = await pty.attach(id);
  let output = '';
  terminal.onData((data) => { output += data; });

  terminal.write('echo sum-$((40+2))\r');
  await waitFor(() => output.includes('sum-42'));

  terminal.resize(100, 40);
  terminal.close();
});

test('a terminal that attaches late is shown the prompt and recent output', async () => {
  const id = newId();
  await pty.create(id);
  const first = await pty.attach(id);
  let seen = '';
  first.onData((data) => { seen += data; });
  first.write('echo marker-$((20+1))\r');
  await waitFor(() => seen.includes('marker-21'));
  first.close();

  const late = await pty.attach(id);
  let replayed = '';
  late.onData((data) => { replayed += data; });
  expect(replayed).toContain('marker-21');
  expect(replayed).toContain('student@opsacademy');
  late.close();
});

test('a pre-warmed shell shows its prompt as soon as a terminal attaches', async () => {
  const id = newId();
  await pty.create(id);
  // Nobody is attached while the shell starts up and prints its prompt.
  await new Promise((resolve) => setTimeout(resolve, 700));
  const terminal = await pty.attach(id);
  let output = '';
  terminal.onData((data) => { output += data; });
  expect(output).toContain('student@opsacademy');
  terminal.close();
});

test('reset wipes the home directory, including dotfiles', async () => {
  const id = newId();
  await pty.create(id);
  await pty.exec(id, 'mkdir -p a/b && touch a/b/c .hidden');
  await pty.reset(id);
  expect((await pty.exec(id, 'ls -A')).stdout.trim()).toBe('');
});

test('destroy kills the shell and removes its directory', async () => {
  const id = newId();
  await pty.create(id);
  const dir = path.join(config.sandbox.sandboxesDir, id);
  expect(fs.existsSync(dir)).toBe(true);
  expect(pty.isAlive(id)).toBe(true);

  expect(await pty.destroy(id)).toBe(true);
  expect(pty.isAlive(id)).toBe(false);
  expect(fs.existsSync(dir)).toBe(false);
  expect(await pty.destroy(id)).toBe(false);
  await expect(pty.exec(id, 'pwd')).rejects.toThrow('Sandbox not found');
  expect(await pty.attach(id)).toBeNull();
});

test('typing exit ends the session', async () => {
  const manager = createManager({ engine: pty, pool: { enabled: false } });
  const session = await manager.createSession('user-1');
  const terminal = await manager.attach(session.sessionId);
  terminal.write('exit\r');
  await waitFor(() => manager.getSession(session.sessionId) === null);
});

test('a command that hangs is cut off by the timeout', async () => {
  const id = newId();
  await pty.create(id);
  const started = Date.now();
  const result = await pty.exec(id, 'sleep 30', { timeoutMs: 300 });
  expect(result.exitCode).not.toBe(0);
  expect(Date.now() - started).toBeLessThan(5000);
});

test('cleanupOrphans removes directories from a previous process only', async () => {
  const id = newId();
  await pty.create(id);
  const orphan = path.join(config.sandbox.sandboxesDir, 'left-behind');
  fs.mkdirSync(orphan, { recursive: true });

  expect(await pty.cleanupOrphans()).toEqual({ directories: 1 });
  expect(fs.existsSync(orphan)).toBe(false);
  expect(fs.existsSync(path.join(config.sandbox.sandboxesDir, id))).toBe(true);
});

test('telemetry lists the files and directories the student created', async () => {
  const manager = createManager({ engine: pty, pool: { enabled: false } });
  const session = await manager.createSession('user-1');
  await manager.exec(session.sessionId, 'mkdir -p webapp/src && touch webapp/src/index.js notes.txt Makefile && mkdir .git');

  const telemetry = await telemetryService.capture(session.sessionId, { manager });

  expect(telemetry.fileTree).toEqual([
    { name: 'Makefile', path: 'Makefile', type: 'file', depth: 0 },
    { name: 'notes.txt', path: 'notes.txt', type: 'file', depth: 0 },
    { name: 'webapp', path: 'webapp', type: 'directory', depth: 0 },
    { name: 'src', path: 'webapp/src', type: 'directory', depth: 1 },
    { name: 'index.js', path: 'webapp/src/index.js', type: 'file', depth: 2 },
  ]);
  expect(Array.isArray(telemetry.processes)).toBe(true);
  expect(Array.isArray(telemetry.ports)).toBe(true);
  await manager.shutdown();
});

describe('lab ports', () => {
  const units = require('../lib/units');
  const stepCheck = (unitId, number) => units.getStep(unitId, number).verification.command;

  test('every shell gets its own ports, in its terminal and in the lab checks', async () => {
    const [a, b] = [newId(), newId()];
    await pty.create(a);
    await pty.create(b);

    const portsA = pty.labEnvOf(a);
    const portsB = pty.labEnvOf(b);
    expect(Object.keys(portsA)).toEqual(['WEB_PORT', 'APP_PORT', 'SITE_PORT']);
    const all = [...Object.values(portsA), ...Object.values(portsB)].map(Number);
    expect(new Set(all).size).toBe(6);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(config.sandbox.ptyPortBase);

    // What a lab check sees.
    expect((await pty.exec(a, 'echo $WEB_PORT $APP_PORT $SITE_PORT')).stdout.trim()).toBe(Object.values(portsA).join(' '));
    // What the student's own shell sees.
    const terminal = await pty.attach(a);
    let screen = '';
    terminal.onData((data) => { screen += data; });
    terminal.write('echo port-is-$WEB_PORT\r');
    await waitFor(() => screen.includes(`port-is-${portsA.WEB_PORT}`));
    terminal.close();
  });

  test('a port block is handed out again once its shell is gone', async () => {
    const first = newId();
    await pty.create(first);
    const ports = pty.labEnvOf(first);
    await pty.destroy(ids.pop());

    const second = newId();
    await pty.create(second);
    expect(pty.labEnvOf(second)).toEqual(ports);
  });

  test('two students can do the "publish a port" docker step at the same time', async () => {
    const students = [newId(), newId()];
    for (const id of students) await pty.create(id);
    const check = stepCheck('docker-basics', 3);

    try {
      for (const id of students) expect((await pty.exec(id, check)).stdout).toContain('FAIL');

      // Both run exactly what the task text says.
      const started = await Promise.all(students.map((id) => pty.exec(id, 'docker run -d --name my-webserver -p $WEB_PORT:80 nginx')));
      for (const result of started) expect(result.exitCode).toBe(0);

      for (const id of students) {
        expect((await pty.exec(id, check)).stdout).toContain('PASS');
        const page = await pty.exec(id, 'curl -s -m 2 localhost:$WEB_PORT');
        expect(page.stdout).toMatch(/nginx/i);
      }
      // Each is talking to their own server, not the other student's.
      const [portA, portB] = students.map((id) => pty.labEnvOf(id).WEB_PORT);
      expect(portA).not.toBe(portB);
    } finally {
      for (const id of students) await pty.exec(id, 'docker rm -f my-webserver');
    }
    for (const id of students) expect((await pty.exec(id, 'curl -s -m 1 localhost:$WEB_PORT || echo closed')).stdout).toContain('closed');
  }, 30000);
});
