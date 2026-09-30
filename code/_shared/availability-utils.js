// ---- shared availability helpers (inlined by scripts/build-workflow.js; requires time-utils) ----
// `av` is the normalized availability object produced by either
// "DEMO · Load Calendar Availability" or "Calendar · Map Free/Busy" (production).

function referenceNow(cfg) {
  if (cfg && cfg.demo_mode && cfg.demo_reference_date) {
    const ms = zonedToUtc(cfg.demo_reference_date, cfg.demo_reference_time || '17:00', cfg.business_timezone);
    if (ms !== null) return ms;
  }
  return Date.now();
}

function isSchedulable(j) {
  return j.request_action === 'book' &&
    j.validation && j.validation.missing_fields.length === 0 && j.validation.invalid_fields.length === 0 &&
    !(j.duplicate && j.duplicate.is_duplicate) &&
    j.timezone_normalization && j.timezone_normalization.status === 'ok';
}

// Evaluate one slot against business rules + calendar. Never mutates inputs.
function checkSlot(startMs, endMs, av, cfg, nowMs) {
  const tz = av.business_timezone;
  const reasons = [];
  const conflicts = [];
  const zs = zonedParts(startMs, tz);
  const date = zs.date;
  const buffer = (Number(cfg.buffer_minutes) || 0) * MIN;
  const noticeMs = (Number(cfg.min_notice_hours) || 0) * 60 * MIN;

  if (startMs < nowMs) reasons.push('start time is in the past');
  else if (startMs < nowMs + noticeMs) reasons.push(`inside the ${cfg.min_notice_hours}h minimum-notice window`);
  if (av.coverage && (date < av.coverage.from || date > av.coverage.to)) reasons.push(`outside calendar data range (${av.coverage.from} to ${av.coverage.to})`);
  if (!av.business_days.includes(weekdayOf(date))) reasons.push(`${weekdayOf(date)} is not a business day`);

  const openMs = zonedToUtc(date, av.business_hours.start, tz);
  const closeMs = zonedToUtc(date, av.business_hours.end, tz);
  if (openMs === null || closeMs === null || startMs < openMs || endMs > closeMs) {
    reasons.push(`outside business hours (${av.business_hours.start}–${av.business_hours.end} ${tz})`);
  }
  for (const b of av.recurring_blocks || []) {
    if (!b.days.includes(weekdayOf(date))) continue;
    const bs = zonedToUtc(date, b.start, tz); const be = zonedToUtc(date, b.end, tz);
    if (bs !== null && be !== null && overlaps(startMs, endMs, bs, be)) reasons.push(`overlaps ${b.label} ${b.start}–${b.end}`);
  }
  for (const ev of av.busy || []) {
    const es = Date.parse(ev.start_utc); const ee = Date.parse(ev.end_utc);
    if (overlaps(startMs, endMs, es - buffer, ee + buffer)) {
      const direct = overlaps(startMs, endMs, es, ee);
      conflicts.push({
        event_id: ev.id, title: ev.title, kind: ev.kind,
        time_business: rangeLabel(es, ee, tz),
        overlap_type: direct ? 'direct overlap' : `within ${cfg.buffer_minutes}-min buffer`,
      });
    }
  }
  if (conflicts.length) reasons.push(`overlaps existing event${conflicts.length > 1 ? 's' : ''}: ${conflicts.map((c) => `${c.title} (${c.overlap_type})`).join('; ')}`);
  return { ok: reasons.length === 0, reasons, conflicts };
}

// Requester-side sanity: do not propose slots at unreasonable local hours for the requester.
function withinRequesterDay(startMs, endMs, requesterTz, cfg) {
  const s = zonedParts(startMs, requesterTz); const e = zonedParts(endMs, requesterTz);
  const lo = minutesOfDay(cfg.requester_day_start || '08:00'); const hi = minutesOfDay(cfg.requester_day_end || '19:00');
  const sm = minutesOfDay(s.time); const em = minutesOfDay(e.time);
  return s.date === e.date && sm >= lo && em <= hi;
}

function overlapsHeld(startMs, endMs, holds, cfg, ownId) {
  const buffer = (Number(cfg.buffer_minutes) || 0) * MIN;
  return holds.find((h) => h.booking_id !== ownId && overlaps(startMs, endMs, h.start - buffer, h.end + buffer)) || null;
}

// Pick up to `max` ranked candidates with day/spacing diversity, skipping excluded slots.
function pickDiverse(ranked, cfg, isExcluded) {
  const max = Number(cfg.max_candidate_slots) || 3;
  const perDay = Number(cfg.max_candidates_per_day) || 2;
  const spacing = (Number(cfg.min_candidate_spacing_minutes) || 60) * MIN;
  const picked = [];
  for (const c of ranked) {
    if (picked.length >= max) break;
    const s = Date.parse(c.start_utc); const e = Date.parse(c.end_utc);
    if (isExcluded && isExcluded(s, e)) continue;
    const sameDay = picked.filter((p) => p.business_date === c.business_date);
    if (sameDay.length >= perDay) continue;
    if (sameDay.some((p) => Math.abs(Date.parse(p.start_utc) - s) < spacing)) continue;
    picked.push(c);
  }
  return picked;
}
// ---- end shared availability helpers ----
