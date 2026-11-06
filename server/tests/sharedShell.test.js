const { PassThrough } = require('stream');
const { SharedShell } = require('../lib/sharedShell');

function shell(options = {}) {
  const stream = new PassThrough();
  const resizes = [];
  const written = [];
  stream.on('data', () => {}); // keep flowing
  const originalWrite = stream.write.bind(stream);
  const instance = new SharedShell({ stream, resize: (c, r) => resizes.push([c, r]), ...options });
  // what the student types goes to the shell's stdin; here the PassThrough echoes it back like a tty would
  stream.write = (data) => { written.push(String(data)); return originalWrite(data); };
  return { stream, instance, resizes, written };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a later connection is shown the recent output, then live output, and closing it leaves the shell running', async () => {
  const { stream, instance } = shell();
  const first = instance.attach();
  const seen1 = [];
  first.onData((d) => seen1.push(d));
  stream.emit('data', Buffer.from('prompt$ '));
  stream.emit('data', Buffer.from('ls\r\nfile.txt\r\n'));
  await tick();
  expect(seen1.join('')).toBe('prompt$ ls\r\nfile.txt\r\n');

  first.close(); // the browser dropped
  stream.emit('data', Buffer.from('background job done\r\n'));

  const second = instance.attach();
  const seen2 = [];
  second.onData((d) => seen2.push(d));
  expect(seen2[0]).toBe('prompt$ ls\r\nfile.txt\r\nbackground job done\r\n'); // replay includes what happened while away
  stream.emit('data', Buffer.from('$ '));
  expect(seen2.at(-1)).toBe('$ ');
  expect(seen1.join('')).not.toContain('background job done'); // the closed attachment hears nothing more
});

test('two connections at once both see the output and both can type', () => {
  const { stream, instance, written } = shell();
  const a = instance.attach();
  const b = instance.attach();
  const seenA = [];
  const seenB = [];
  a.onData((d) => seenA.push(d));
  b.onData((d) => seenB.push(d));
  stream.emit('data', Buffer.from('hi'));
  expect(seenA).toEqual(['hi']);
  expect(seenB).toEqual(['hi']);
  a.write('x');
  b.write('y');
  expect(written).toEqual(['x', 'y']);
});

test('the replay keeps only the most recent output', () => {
  const { stream, instance } = shell({ scrollbackChars: 10 });
  stream.emit('data', Buffer.from('0123456789ABCDEF'));
  const seen = [];
  instance.attach().onData((d) => seen.push(d));
  expect(seen).toEqual(['6789ABCDEF']);
});

test('a multi-byte character split across chunks is not corrupted', () => {
  const { stream, instance } = shell();
  const seen = [];
  instance.attach().onData((d) => seen.push(d));
  const euro = Buffer.from('€'); // 3 bytes
  stream.emit('data', euro.subarray(0, 1));
  stream.emit('data', euro.subarray(1));
  expect(seen.join('')).toBe('€');
});

test('resize reaches the shell; clearing the replay works', () => {
  const { stream, instance, resizes } = shell();
  instance.attach().resize(120, 40);
  expect(resizes).toEqual([[120, 40]]);
  stream.emit('data', Buffer.from('old screen'));
  instance.clearScrollback();
  const seen = [];
  instance.attach().onData((d) => seen.push(d));
  expect(seen).toEqual([]);
});

test('when the shell ends, every attachment hears it, and a later attachment hears it at once', async () => {
  const { stream, instance } = shell();
  const a = instance.attach();
  let closedA = 0;
  a.onClose(() => { closedA += 1; });
  stream.end();
  stream.emit('close');
  await tick();
  expect(instance.ended).toBe(true);
  expect(closedA).toBe(1);

  let closedLate = 0;
  instance.attach().onClose(() => { closedLate += 1; });
  expect(closedLate).toBe(1);
});

test('a detached attachment is not told when the shell ends later', () => {
  const { stream, instance } = shell();
  const a = instance.attach();
  let told = 0;
  a.onClose(() => { told += 1; });
  a.close();
  stream.emit('close');
  expect(told).toBe(0);
});

test('typing into an ended shell does nothing', () => {
  const { stream, instance, written } = shell();
  const a = instance.attach();
  stream.emit('close');
  a.write('too late');
  a.resize(10, 10);
  expect(written).toEqual([]);
});
