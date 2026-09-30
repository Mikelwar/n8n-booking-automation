// Check Duplicate Booking
// Deterministic duplicate key: normalized email + meeting_type + preferred date + start time within
// a configurable window. Compares against (a) earlier requests in the same batch and (b) the booking
// ledger (demo: embedded from test-data/demo-calendar.json; production: connect a Data Table / CRM lookup).
// Also resolves cancellation targets against the ledger.
// @include _shared/time-utils.js

const DEMO_LEDGER = /*@@DEMO_LEDGER@@*/[];

function tokens(s) { return new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)); }
function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return Math.round((inter / (A.size + B.size - inter)) * 100) / 100;
}
function eligible(j) {
  return j.request_action === 'book' && j.validation.missing_fields.length === 0 && j.validation.invalid_fields.length === 0;
}

const items = $input.all().map((it) => ({ ...it.json }));
const cfg = (items[0] && items[0].config) || {};
const windowMs = (Number(cfg.duplicate_window_minutes) || 60) * MIN;
const ledger = cfg.demo_mode ? DEMO_LEDGER : []; // production: replace with a Data Table / CRM lookup
const ledgerStarts = ledger.map((b) => ({ ...b, start_ms: zonedToUtc(b.date, b.start, cfg.business_timezone) }));

// Earliest submission wins: process in timestamp order, then booking_id.
const order = items.map((j, idx) => idx).sort((a, b) =>
  String(items[a].timestamp).localeCompare(String(items[b].timestamp)) || String(items[a].booking_id).localeCompare(String(items[b].booking_id)));
const seen = [];

for (const idx of order) {
  const j = items[idx];
  const result = { is_duplicate: false, duplicate_of: null, matched_source: null, match_basis: [], topic_similarity: null };
  j.dedupe_key = eligible(j) ? `${j.email}|${j.meeting_type}|${j.preferred_date}` : null;

  if (j.request_action === 'cancel') {
    const target = ledger.find((b) => b.booking_id === j.original_booking_id) || null;
    j.ledger_match = {
      lookup: cfg.demo_mode ? 'demo ledger' : 'not connected (production: Data Table / CRM lookup)',
      found: !!target,
      email_matches: !!target && target.email.toLowerCase() === j.email,
      booking: target,
    };
  } else if (eligible(j)) {
    const startMs = zonedToUtc(j.preferred_date, j.preferred_start_time, j.timezone);
    const near = (ms) => startMs !== null && ms !== null && Math.abs(ms - startMs) <= windowMs;
    const ledgerHit = ledgerStarts.find((b) => b.status !== 'CANCELLED' && b.email.toLowerCase() === j.email && b.meeting_type === j.meeting_type && near(b.start_ms));
    const batchHit = seen.find((s) => s.dedupe_key === j.dedupe_key && near(s.start_ms));
    const hit = ledgerHit ? { id: ledgerHit.booking_id, src: 'existing booking ledger', topic: '' } : batchHit ? { id: batchHit.booking_id, src: 'same intake batch', topic: batchHit.topic } : null;
    if (hit) {
      result.is_duplicate = true;
      result.duplicate_of = hit.id;
      result.matched_source = hit.src;
      result.match_basis = ['email (normalized)', 'meeting_type', 'preferred_date', `start time within ${cfg.duplicate_window_minutes} min`];
      result.topic_similarity = similarity(j.meeting_topic, hit.topic);
    } else {
      seen.push({ booking_id: j.booking_id, dedupe_key: j.dedupe_key, start_ms: startMs, topic: j.meeting_topic });
    }
  }
  j.duplicate = result;
}

return items.map((json, i) => ({ json, pairedItem: { item: i } }));
