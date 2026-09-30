// ---- shared time helpers (inlined by scripts/build-workflow.js) ----
// Pure Intl-based timezone math: no external libraries, DST-safe, deterministic.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN = 60 * 1000;

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  // Only accept IANA-style names ("Area/City" or "UTC"); abbreviations like "EST" are ambiguous.
  if (!/^(UTC|Etc\/[A-Za-z0-9+\-]+|[A-Za-z]+\/[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)?)$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

function zonedParts(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: p.weekday,
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`,
  };
}

function tzOffsetMinutes(utcMs, tz) {
  const z = zonedParts(utcMs, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MIN);
}

function tzAbbrev(utcMs, tz) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date(utcMs)).find((x) => x.type === 'timeZoneName');
  return part ? part.value : tz;
}

// Wall-clock date + time in `tz` -> UTC epoch ms. Returns null for invalid or non-existent (DST gap) times.
function zonedToUtc(dateStr, timeStr, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  const t = /^(\d{2}):(\d{2})$/.exec(timeStr || '');
  if (!d || !t || !isValidTimeZone(tz)) return null;
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  let utc = naive - tzOffsetMinutes(naive, tz) * MIN;
  const off2 = tzOffsetMinutes(utc, tz);
  utc = naive - off2 * MIN;
  const check = zonedParts(utc, tz);
  if (check.date !== dateStr || check.time !== timeStr) return null; // DST gap or invalid calendar date
  return utc;
}

function toIsoUtc(ms) { return new Date(ms).toISOString().replace('.000Z', 'Z'); }

function localLabel(utcMs, tz) {
  const z = zonedParts(utcMs, tz);
  return `${z.weekday} ${z.day} ${MONTHS[z.month - 1]} ${z.year}, ${z.time}`;
}

function rangeLabel(startMs, endMs, tz) {
  return `${localLabel(startMs, tz)}–${zonedParts(endMs, tz).time} ${tzAbbrev(startMs, tz)} (${tz})`;
}

function minutesOfDay(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : null;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function dayDiff(a, b) {
  const pa = a.split('-').map(Number); const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }

function slotView(startMs, endMs, requesterTz, businessTz) {
  return {
    start_utc: toIsoUtc(startMs),
    end_utc: toIsoUtc(endMs),
    local: requesterTz && isValidTimeZone(requesterTz) ? rangeLabel(startMs, endMs, requesterTz) : null,
    business: rangeLabel(startMs, endMs, businessTz),
  };
}
// ---- end shared time helpers ----
