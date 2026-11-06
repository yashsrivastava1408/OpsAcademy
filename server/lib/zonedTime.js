/**
 * Wall-clock times in a named time zone (a college's own), without a date library.
 * A slot "Saturday 10:00" means 10:00 where the college is, whatever the server's zone.
 */

const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return formatters.get(timeZone);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The local calendar fields of an instant: { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0-6 (Sunday = 0) } */
function localParts(ms, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: WEEKDAYS[p.weekday] };
}

/** Minutes the zone is ahead of UTC at this instant. */
function offsetMinutes(ms, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The instant (epoch ms) at which it is `dateStr` `timeStr` on the clocks of `timeZone`. */
function zonedToUtcMs(dateStr, timeStr, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let guess = naive - offsetMinutes(naive, timeZone) * 60000;
  guess = naive - offsetMinutes(guess, timeZone) * 60000; // once more: the offset can differ across a daylight-saving change
  return guess;
}

/** 'YYYY-MM-DD' plus n days (calendar arithmetic, no zone involved). */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 0 (Sunday) to 6 (Saturday) for a calendar date. */
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; // rejects 2026-02-30
};
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

module.exports = { localParts, offsetMinutes, zonedToUtcMs, addDays, weekdayOf, isDate, isTime };
