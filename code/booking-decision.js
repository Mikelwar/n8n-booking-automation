// Booking Decision
// Assigns exactly one booking_status per request using deterministic rules, in this order:
//   CANCELLED / INVALID / NEEDS_REVIEW (incomplete) / DUPLICATE / NEEDS_REVIEW (security, timezone,
//   availability unknown) / READY_TO_CONFIRM / PROPOSE_ALTERNATIVE / NO_AVAILABILITY
// Batch-level slot holds prevent two requests in the same run from getting the same time:
//   pass 1 reserves requested slots (priority order), pass 2 builds proposals from what is left.
// Nothing is booked here: READY_TO_CONFIRM means "slot held, confirmation draft needed".
// @include _shared/time-utils.js
// @include _shared/availability-utils.js

const PRIORITY_ORDER = { HIGH: 0, NORMAL: 1, LOW: 2 };
const FIELD_LABELS = {
  timezone: 'your time zone', requested_duration_minutes: 'the meeting length', email: 'an email address',
  full_name: 'your full name', meeting_type: 'the type of meeting', preferred_date: 'a preferred date',
  preferred_start_time: 'a preferred start time', original_booking_id: 'the booking reference',
};

const items = $input.all().map((it) => ({ ...it.json }));
const cfg = (items[0] && items[0].config) || {};
const holds = [];
const order = items.map((_, idx) => idx).sort((a, b) =>
  (PRIORITY_ORDER[items[a].booking_priority] - PRIORITY_ORDER[items[b].booking_priority]) ||
  String(items[a].timestamp).localeCompare(String(items[b].timestamp)) ||
  String(items[a].booking_id).localeCompare(String(items[b].booking_id)));

function finalize(j, status, fields) {
  Object.assign(j, {
    booking_status: status,
    review_reason: null,
    candidate_slots: [],
    selected_slot: null,
    selected_slot_reason: null,
    requires_confirmation: false,
    requires_draft: false,
  }, fields);
  j.status_label = j.booking_priority === 'HIGH' && ['READY_TO_CONFIRM', 'PROPOSE_ALTERNATIVE', 'NO_AVAILABILITY'].includes(status) ? `PRIORITY · ${status}` : status;
}

// ---- pass 1: non-schedulable outcomes + requested-slot reservations ----
const needsProposal = [];
for (const idx of order) {
  const j = items[idx];
  const v = j.validation;
  const trace = [];
  j.decision_trace = trace;

  if (j.request_action === 'cancel') {
    const lm = j.ledger_match || {};
    if (v.missing_fields.length || v.invalid_fields.length) {
      trace.push('cancellation request incomplete');
      finalize(j, v.invalid_fields.length ? 'INVALID' : 'NEEDS_REVIEW', { review_reason: 'INCOMPLETE', recommended_action: 'Ask requester for the booking reference and contact details.', requires_draft: v.invalid_fields.length === 0 });
    } else if (lm.found && lm.email_matches) {
      trace.push(`original booking ${j.original_booking_id} found; requester email matches`);
      finalize(j, 'CANCELLED', {
        recommended_action: `Human approval required, then cancel calendar event ${lm.booking.calendar_event_id} for ${j.original_booking_id}. The slot is only released after the calendar update.`,
        requires_confirmation: true, requires_draft: true,
        cancelled_booking: { booking_id: lm.booking.booking_id, calendar_event_id: lm.booking.calendar_event_id, date: lm.booking.date, start: lm.booking.start, end: lm.booking.end },
      });
    } else {
      trace.push(lm.found ? 'requester email does not match the original booking' : 'original booking not found');
      finalize(j, 'NEEDS_REVIEW', { review_reason: lm.found ? 'CANCEL_EMAIL_MISMATCH' : 'CANCEL_TARGET_NOT_FOUND', recommended_action: 'Verify identity and booking reference manually before cancelling anything.' });
    }
    continue;
  }
  if (v.invalid_fields.length) {
    trace.push(`invalid fields: ${v.invalid_fields.map((f) => f.field).join(', ')}`);
    finalize(j, 'INVALID', { review_reason: 'INVALID_FIELDS', recommended_action: 'Do not book. Review raw request; contact requester only through a verified channel.' });
    continue;
  }
  if (v.missing_fields.length) {
    trace.push(`missing fields: ${v.missing_fields.join(', ')}`);
    finalize(j, 'NEEDS_REVIEW', {
      review_reason: 'INCOMPLETE',
      missing_fields_readable: v.missing_fields.map((f) => FIELD_LABELS[f] || f),
      recommended_action: `Send the draft asking for: ${v.missing_fields.map((f) => FIELD_LABELS[f] || f).join(', ')}.`,
      requires_draft: !v.missing_fields.includes('email'),
    });
    continue;
  }
  if (j.duplicate && j.duplicate.is_duplicate) {
    trace.push(`duplicate of ${j.duplicate.duplicate_of} (${j.duplicate.matched_source})`);
    finalize(j, 'DUPLICATE', { review_reason: 'DUPLICATE', recommended_action: `No new booking. Link to ${j.duplicate.duplicate_of}; no second invite or hold is created.` });
    continue;
  }
  if (j.security && j.security.injection_detected) {
    trace.push(`untrusted-input signals: ${j.security.matched_signals.map((s) => `${s.signal}@${s.field}`).join(', ')}`);
    finalize(j, 'NEEDS_REVIEW', { review_reason: 'SECURITY_FLAG', recommended_action: 'Human review required. Instruction-like text was ignored; no hold, no draft, no priority change.' });
    continue;
  }
  if (!j.timezone_normalization || j.timezone_normalization.status !== 'ok') {
    trace.push('timezone normalization did not complete');
    finalize(j, 'NEEDS_REVIEW', { review_reason: 'TIMEZONE', recommended_action: 'Confirm the requester\'s timezone and time manually.' });
    continue;
  }
  if (!j.availability || j.availability.status !== 'ok') {
    trace.push(`availability unknown: ${(j.availability && j.availability.reason) || 'no data'}`);
    finalize(j, 'NEEDS_REVIEW', { review_reason: 'AVAILABILITY_UNKNOWN', recommended_action: 'Calendar availability could not be verified. Never confirm without a free/busy check.' });
    continue;
  }

  const s = Date.parse(j.requested_start_utc); const e = Date.parse(j.requested_end_utc);
  if (j.requested_slot_available) {
    const held = overlapsHeld(s, e, holds, cfg, j.booking_id);
    if (!held) {
      holds.push({ booking_id: j.booking_id, start: s, end: e, kind: 'confirmation_hold' });
      trace.push('requested slot free in calendar and not held in this batch → held');
      finalize(j, 'READY_TO_CONFIRM', {
        selected_slot: slotView(s, e, j.timezone, j.business_timezone),
        selected_slot_reason: 'Requested slot is available',
        recommended_action: 'Review and send the confirmation draft; create the calendar event after the requester confirms.',
        requires_confirmation: true, requires_draft: true,
      });
      continue;
    }
    j.conflict_detected = true;
    j.requested_slot_available = false;
    j.conflict_reason = `Requested slot is already held for ${held.booking_id} earlier in this batch`;
    trace.push(j.conflict_reason);
  } else {
    trace.push(`requested slot unavailable: ${j.conflict_reason}`);
  }
  // Flexible window: another slot fully inside the requester's own window counts as their requested time.
  const inWindow = (j.ranked_candidates || []).find((c) => c.within_preferred_window && !overlapsHeld(Date.parse(c.start_utc), Date.parse(c.end_utc), holds, cfg, j.booking_id));
  if (inWindow) {
    const cs = Date.parse(inWindow.start_utc); const ce = Date.parse(inWindow.end_utc);
    holds.push({ booking_id: j.booking_id, start: cs, end: ce, kind: 'confirmation_hold' });
    trace.push('free slot found inside the requester\'s stated window → held');
    finalize(j, 'READY_TO_CONFIRM', {
      selected_slot: slotView(cs, ce, j.timezone, j.business_timezone),
      selected_slot_reason: 'Inside the requester\'s stated time window',
      recommended_action: 'Review and send the confirmation draft; create the calendar event after the requester confirms.',
      requires_confirmation: true, requires_draft: true,
    });
    continue;
  }
  needsProposal.push(idx);
}

// ---- pass 2: alternatives from what is still free (proposals are soft-held so nobody gets the same offer) ----
for (const idx of needsProposal) {
  const j = items[idx];
  const picks = pickDiverse(j.ranked_candidates || [], cfg, (s, e) => !!overlapsHeld(s, e, holds, cfg, j.booking_id));
  for (const p of picks) holds.push({ booking_id: j.booking_id, start: Date.parse(p.start_utc), end: Date.parse(p.end_utc), kind: 'proposal_hold' });
  const candidates = picks.map((p, n) => ({
    option: n + 1,
    start_utc: p.start_utc, end_utc: p.end_utc,
    local: p.local, business: p.business,
    business_date: p.business_date,
    reason: p.rank_reason,
  }));
  const top = candidates[0] || null;
  const common = {
    candidate_slots: candidates,
    selected_slot: top ? { start_utc: top.start_utc, end_utc: top.end_utc, local: top.local, business: top.business } : null,
    selected_slot_reason: top ? `Recommended option 1 (not booked, awaiting requester's choice): ${top.reason}` : null,
    requires_confirmation: candidates.length > 0,
    requires_draft: true,
  };
  if (!candidates.length) {
    j.decision_trace.push('no feasible slot in the search horizon');
    finalize(j, 'NO_AVAILABILITY', { ...common, review_reason: 'NO_SLOTS_IN_HORIZON', recommended_action: 'Escalate to the owner to open capacity or extend the search horizon; send the holding reply.' });
  } else if (!j.preferred_day_capacity) {
    j.decision_trace.push(`requested day(s) fully booked → ${candidates.length} next-best option(s) proposed`);
    finalize(j, 'NO_AVAILABILITY', { ...common, review_reason: 'REQUESTED_DAY_FULLY_BOOKED', recommended_action: 'Send the next-best options; do not book until the requester picks one.' });
  } else {
    j.decision_trace.push(`${candidates.length} alternative(s) proposed`);
    finalize(j, 'PROPOSE_ALTERNATIVE', { ...common, recommended_action: j.booking_priority === 'HIGH' ? 'Send alternatives within the HIGH-priority SLA; owner should call if no reply.' : 'Send the alternatives and wait for the requester to choose.' });
  }
}

for (const j of items) {
  j.selected_slot_local = j.selected_slot ? j.selected_slot.local : null;
  j.selected_slot_utc = j.selected_slot ? `${j.selected_slot.start_utc} → ${j.selected_slot.end_utc}` : null;
  j.selected_time_local = j.selected_slot_local;
  j.selected_time_utc = j.selected_slot ? j.selected_slot.start_utc : null;
  j.batch_holds = holds.filter((h) => h.booking_id === j.booking_id).map((h) => ({ kind: h.kind, start_utc: toIsoUtc(h.start), end_utc: toIsoUtc(h.end) }));
}
return items.map((json, i) => ({ json, pairedItem: { item: i } }));
