const { localParts, zonedToUtcMs, addDays, weekdayOf, isDate, isTime } = require('../lib/zonedTime');

test('10:00 on a Saturday in India is 04:30 UTC', () => {
  expect(new Date(zonedToUtcMs('2026-11-07', '10:00', 'Asia/Kolkata')).toISOString()).toBe('2026-11-07T04:30:00.000Z');
  expect(localParts(Date.UTC(2026, 10, 7, 4, 30), 'Asia/Kolkata')).toEqual({ date: '2026-11-07', time: '10:00', weekday: 6 });
});

test('the same wall-clock time is a different instant in other zones, including across daylight saving', () => {
  expect(new Date(zonedToUtcMs('2026-11-07', '10:00', 'UTC')).toISOString()).toBe('2026-11-07T10:00:00.000Z');
  expect(new Date(zonedToUtcMs('2026-01-15', '09:00', 'America/New_York')).toISOString()).toBe('2026-01-15T14:00:00.000Z'); // EST
  expect(new Date(zonedToUtcMs('2026-07-15', '09:00', 'America/New_York')).toISOString()).toBe('2026-07-15T13:00:00.000Z'); // EDT
});

test('a time just before midnight belongs to its own local day', () => {
  const ms = zonedToUtcMs('2026-11-07', '23:30', 'Asia/Kolkata');
  expect(localParts(ms, 'Asia/Kolkata').date).toBe('2026-11-07');
  expect(localParts(ms, 'UTC').date).toBe('2026-11-07');
  expect(localParts(zonedToUtcMs('2026-11-08', '00:15', 'Asia/Kolkata'), 'UTC').date).toBe('2026-11-07');
});

test('calendar helpers', () => {
  expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(weekdayOf('2026-11-07')).toBe(6);
  expect(isDate('2026-02-30')).toBe(false);
  expect(isDate('2026-11-07')).toBe(true);
  expect(isTime('24:00')).toBe(false);
  expect(isTime('09:05')).toBe(true);
});
