// Detect Conflict
// Checks the exact requested slot against business days/hours, recurring blocks (lunch),
// existing events (+ buffer), minimum notice and calendar coverage.
// @include _shared/time-utils.js
// @include _shared/availability-utils.js

const out = [];
for (const [i, item] of $input.all().entries()) {
  const j = { ...item.json };
  const cfg = j.config || {};
  const av = j.availability;

  if (!isSchedulable(j)) {
    j.conflict_check = { status: 'skipped', reason: 'request is not schedulable (invalid, incomplete, duplicate or cancellation)' };
    j.conflict_detected = null;
    j.conflict_reason = null;
    j.conflicting_event = null;
    j.requested_slot_available = null;
  } else if (!av || av.status !== 'ok') {
    j.conflict_check = { status: 'availability_unknown', reason: (av && av.reason) || 'no availability data' };
    j.conflict_detected = null;
    j.conflict_reason = 'Availability could not be verified';
    j.conflicting_event = null;
    j.requested_slot_available = null;
  } else {
    const s = Date.parse(j.requested_start_utc); const e = Date.parse(j.requested_end_utc);
    const res = checkSlot(s, e, av, cfg, referenceNow(cfg));
    j.conflict_check = { status: 'checked', checks: ['minimum notice', 'calendar coverage', 'business day', 'business hours', 'recurring blocks', `existing events (+${cfg.buffer_minutes} min buffer)`] };
    j.conflict_detected = !res.ok;
    j.conflict_reason = res.ok ? null : res.reasons.join('; ');
    j.conflicting_event = res.conflicts[0] || null;
    j.conflicting_events = res.conflicts;
    j.requested_slot_available = res.ok;
  }
  out.push({ json: j, pairedItem: { item: i } });
}
return out;
