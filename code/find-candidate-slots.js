// Find Candidate Slots
// 1) Evaluates booking priority with deterministic rules (structured fields only; free text never counts).
// 2) Generates every feasible slot in the search horizon: business hours, no blocks/conflicts,
//    exact duration, minimum notice, and reasonable local hours for the requester.
// @include _shared/time-utils.js
// @include _shared/availability-utils.js

const EXEC_ROLE = /\b(ceo|coo|cfo|cto|cio|chief|president|vp|vice president|founder|managing director|executive)\b/i;

function evaluatePriority(j) {
  let score = 0; const reasons = [];
  if (EXEC_ROLE.test(j.role || '')) { score += 2; reasons.push(`executive requester (${j.role})`); }
  if (j.meeting_type === 'client_escalation') { score += 2; reasons.push('existing-client escalation'); }
  if (j.urgency === 'urgent' || j.urgency === 'high') { score += 1; reasons.push(`declared urgency: ${j.urgency} (self-declared, +1 only)`); }
  if (j.urgency === 'low') { score -= 1; reasons.push('declared urgency: low'); }
  if (j.meeting_type === 'general_inquiry') { score -= 1; reasons.push('informational request'); }
  let level = score >= 2 ? 'HIGH' : score < 0 ? 'LOW' : 'NORMAL';
  if (level === 'HIGH' && j.security && j.security.injection_detected) {
    level = 'NORMAL'; reasons.push('capped at NORMAL: untrusted-input flags present');
  }
  if (!reasons.length) reasons.push('standard request');
  return { level, score, reasons };
}

const out = [];
for (const [i, item] of $input.all().entries()) {
  const j = { ...item.json };
  const cfg = j.config || {};
  const pr = evaluatePriority(j);
  j.booking_priority = pr.level;
  j.priority_score = pr.score;
  j.priority_reasons = pr.reasons;

  const av = j.availability;
  if (!isSchedulable(j) || !av || av.status !== 'ok') {
    j.raw_candidates = [];
    j.candidate_search = { status: 'skipped' };
    out.push({ json: j, pairedItem: { item: i } });
    continue;
  }

  const tz = av.business_timezone;
  const nowMs = referenceNow(cfg);
  const dur = j.requested_duration_minutes * MIN;
  const step = (Number(cfg.slot_step_minutes) || 15) * MIN;
  const horizon = Number(cfg.search_horizon_days) || 10;
  const reqStart = Date.parse(j.requested_start_utc);
  const reqBizMinutes = minutesOfDay(zonedParts(reqStart, tz).time);
  const winStart = Date.parse(j.preferred_window.start_utc); const winEnd = Date.parse(j.preferred_window.end_utc);
  const preferredDate = j.requested_business_date;
  const altDates = j.alternative_business_dates || [];

  // HIGH priority may be offered slots earlier than the requested day; others start at the requested day.
  const earliestDate = zonedParts(nowMs + (Number(cfg.min_notice_hours) || 0) * 60 * MIN, tz).date;
  let fromDate = pr.level === 'HIGH' ? earliestDate : preferredDate;
  if (av.coverage && fromDate < av.coverage.from) fromDate = av.coverage.from;
  let toDate = addDays(preferredDate, horizon);
  if (av.coverage && toDate > av.coverage.to) toDate = av.coverage.to;
  const dates = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) dates.push(d);
  for (const d of altDates) if (!dates.includes(d) && (!av.coverage || (d >= av.coverage.from && d <= av.coverage.to))) dates.push(d);
  dates.sort();

  const raw = []; let rejectedRequesterHours = 0;
  for (const date of dates) {
    if (!av.business_days.includes(weekdayOf(date))) continue;
    const open = zonedToUtc(date, av.business_hours.start, tz); const close = zonedToUtc(date, av.business_hours.end, tz);
    if (open === null || close === null) continue;
    for (let s = open; s + dur <= close; s += step) {
      const e = s + dur;
      if (!checkSlot(s, e, av, cfg, nowMs).ok) continue;
      if (!withinRequesterDay(s, e, j.timezone, cfg)) { rejectedRequesterHours++; continue; }
      const bizTime = zonedParts(s, tz).time;
      raw.push({
        ...slotView(s, e, j.timezone, tz),
        business_date: date,
        is_preferred_date: date === preferredDate,
        is_alternative_date: altDates.includes(date),
        within_preferred_window: s >= winStart && e <= winEnd,
        day_offset: dayDiff(preferredDate, date),
        minutes_from_requested_time: Math.abs(minutesOfDay(bizTime) - reqBizMinutes),
      });
    }
  }
  j.raw_candidates = raw.slice(0, 80);
  // Calendar-only capacity on the requester's preferred/alternative days (before in-batch holds).
  j.preferred_day_capacity = raw.filter((c) => c.is_preferred_date || c.is_alternative_date).length;
  j.candidate_search = {
    status: 'ok',
    strategy: pr.level === 'HIGH' ? 'HIGH priority: earliest feasible slot first (may be before the requested day)' : 'requested day first, then alternative dates, then closest next business days',
    searched_dates: `${fromDate} → ${toDate}${altDates.length ? ` (+ alternative dates ${altDates.join(', ')})` : ''}`,
    feasible_slots_found: raw.length,
    rejected_outside_requester_local_hours: rejectedRequesterHours,
  };
  out.push({ json: j, pairedItem: { item: i } });
}
return out;
