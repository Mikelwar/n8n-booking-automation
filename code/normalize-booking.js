// Normalize Booking Request
// Accepts demo items (flat JSON) or webhook items ({ headers, query, body }) and produces one
// canonical request shape. Never throws on bad input: problems are recorded for validation.

const TEXT_LIMITS = { full_name: 120, email: 254, phone: 40, company: 120, role: 120, meeting_topic: 160, message: 2000, notes: 1000 };
const MEETING_TYPE_ALIASES = {
  demo: 'product_demo', product_demo: 'product_demo',
  sales: 'sales_meeting', sales_call: 'sales_meeting', sales_meeting: 'sales_meeting',
  escalation: 'client_escalation', client_escalation: 'client_escalation',
  intro: 'consultation', discovery: 'consultation', discovery_call: 'consultation', consultation: 'consultation',
  onboarding: 'onboarding', support: 'support_session', support_session: 'support_session',
  qbr: 'quarterly_review', quarterly_review: 'quarterly_review',
  internal: 'internal_sync', internal_sync: 'internal_sync',
  info: 'general_inquiry', inquiry: 'general_inquiry', general_inquiry: 'general_inquiry',
};
const URGENCY_ALIASES = { low: 'low', normal: 'normal', medium: 'normal', standard: 'normal', high: 'high', urgent: 'urgent', asap: 'urgent', critical: 'urgent' };

function cleanText(v, max) {
  if (v === null || v === undefined) return '';
  // Strip control characters, collapse whitespace, cap length.
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 500);
}

function parseTime(v, notes, field) {
  const s = cleanText(v, 20).toLowerCase();
  if (!s) return '';
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) { notes.push(`${field}: could not parse "${s}"`); return s; }
  let h = +m[1]; const min = m[2] ? +m[2] : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) { notes.push(`${field}: out of range "${s}"`); return s; }
  const out = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  if (out !== s) notes.push(`${field}: "${s}" normalized to ${out}`);
  return out;
}

function parseDate(v, notes, field) {
  const s = cleanText(v, 20);
  if (!s) return '';
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) { notes.push(`${field}: "${s}" is not an ISO date (YYYY-MM-DD)`); return s; }
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function parseDuration(v, notes) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/min(ute)?s?/i, '').trim());
  if (!Number.isFinite(n)) { notes.push(`requested_duration_minutes: "${v}" is not a number`); return null; }
  return Math.round(n);
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).toUpperCase();
}

const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const j = items[i].json || {};
  const fromWebhook = j.body !== undefined && (j.headers !== undefined || j.query !== undefined);
  const raw = fromWebhook ? (typeof j.body === 'object' && j.body !== null ? j.body : { message: String(j.body) }) : j;
  const notes = [];

  const email = cleanText(raw.email, TEXT_LIMITS.email).toLowerCase();
  const typeKey = cleanText(raw.meeting_type, 60).toLowerCase().replace(/[\s-]+/g, '_');
  const meetingType = MEETING_TYPE_ALIASES[typeKey] || typeKey;
  if (typeKey && meetingType !== typeKey) notes.push(`meeting_type: "${raw.meeting_type}" mapped to ${meetingType}`);
  const urgencyKey = cleanText(raw.urgency, 20).toLowerCase();
  const urgency = URGENCY_ALIASES[urgencyKey] || 'normal';
  if (urgencyKey && !URGENCY_ALIASES[urgencyKey]) notes.push(`urgency: unknown value "${urgencyKey}" treated as normal`);

  const altDates = (Array.isArray(raw.alternative_dates) ? raw.alternative_dates : String(raw.alternative_dates || '').split(','))
    .map((d) => parseDate(d, notes, 'alternative_dates')).filter(Boolean).slice(0, 5);
  const participants = (Array.isArray(raw.participants) ? raw.participants : String(raw.participants || '').split(','))
    .map((p) => cleanText(p, 254).toLowerCase()).filter(Boolean).slice(0, 10);

  const timestamp = cleanText(raw.timestamp, 40) || new Date().toISOString();
  const bookingId = cleanText(raw.booking_id, 40) || `BK-W${fnv(email + '|' + timestamp)}`;
  const record = {
    booking_id: bookingId,
    scenario: cleanText(raw.scenario, 120) || null,
    request_action: cleanText(raw.request_action, 20).toLowerCase() === 'cancel' ? 'cancel' : 'book',
    original_booking_id: cleanText(raw.original_booking_id, 40) || null,
    full_name: cleanText(raw.full_name, TEXT_LIMITS.full_name),
    email,
    phone: cleanText(raw.phone, TEXT_LIMITS.phone),
    company: cleanText(raw.company, TEXT_LIMITS.company),
    role: cleanText(raw.role, TEXT_LIMITS.role),
    meeting_type: meetingType,
    meeting_topic: cleanText(raw.meeting_topic, TEXT_LIMITS.meeting_topic),
    message: cleanText(raw.message, TEXT_LIMITS.message),
    requested_duration_minutes: parseDuration(raw.requested_duration_minutes, notes),
    timezone: cleanText(raw.timezone, 64),
    preferred_date: parseDate(raw.preferred_date, notes, 'preferred_date'),
    preferred_start_time: parseTime(raw.preferred_start_time, notes, 'preferred_start_time'),
    preferred_end_time: parseTime(raw.preferred_end_time, notes, 'preferred_end_time'),
    alternative_dates: altDates,
    urgency,
    source: cleanText(raw.source, 60) || (fromWebhook ? 'webhook' : 'unknown'),
    timestamp,
    participants,
    location_preference: cleanText(raw.location_preference, 40).toLowerCase(),
    notes: cleanText(raw.notes, TEXT_LIMITS.notes),
    intake_channel: fromWebhook ? 'webhook' : 'demo',
    normalization_notes: notes,
  };
  // Free-text requests (message present, structured scheduling fields missing) may use the optional AI interpretation path.
  record.needs_interpretation = record.request_action === 'book' && !!record.message &&
    (!record.preferred_date || !record.preferred_start_time || !record.requested_duration_minutes || !record.timezone);
  record.raw_request = raw; // preserved verbatim for audit / human review
  out.push({ json: record, pairedItem: { item: i } });
}
return out;
