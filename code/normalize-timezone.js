// Normalize Timezone
// Converts the requester's wall-clock request into canonical UTC, keeps the requester's local view
// and the business-calendar view side by side. Timezone-less requests are never guessed.
// @include _shared/time-utils.js
// @include _shared/availability-utils.js

const out = [];
for (const [i, item] of $input.all().entries()) {
  const j = { ...item.json };
  const cfg = j.config || {};
  const businessTz = cfg.business_timezone;
  const tz = j.timezone;
  j.requester_timezone = tz || null;
  j.canonical_timezone = cfg.canonical_timezone || 'UTC';
  j.business_timezone = businessTz;

  const skipReason =
    j.request_action === 'cancel' ? 'cancellation request (no new slot)' :
    !tz ? 'timezone missing: local times are not interpreted without a timezone' :
    !isValidTimeZone(tz) ? `invalid timezone "${tz}"` :
    !/^\d{4}-\d{2}-\d{2}$/.test(j.preferred_date || '') || !/^\d{2}:\d{2}$/.test(j.preferred_start_time || '') ? 'preferred date/time missing or invalid' :
    !Number.isInteger(j.requested_duration_minutes) ? 'duration missing or invalid' : null;

  if (skipReason) {
    j.timezone_normalization = { status: 'skipped', reason: skipReason };
    j.requested_time_local = j.preferred_date && j.preferred_start_time ? `${j.preferred_date} ${j.preferred_start_time} (timezone unknown)` : null;
    j.requested_time_utc = null;
    out.push({ json: j, pairedItem: { item: i } });
    continue;
  }

  const startMs = zonedToUtc(j.preferred_date, j.preferred_start_time, tz);
  if (startMs === null) {
    j.timezone_normalization = { status: 'failed', reason: `${j.preferred_date} ${j.preferred_start_time} does not exist in ${tz} (DST transition)` };
    j.validation = {
      ...j.validation,
      is_valid: false,
      invalid_fields: [...j.validation.invalid_fields, { field: 'preferred_start_time', reason: 'non-existent local time (DST gap)', value: j.preferred_start_time }],
    };
    j.requested_time_utc = null;
    out.push({ json: j, pairedItem: { item: i } });
    continue;
  }
  const endMs = startMs + j.requested_duration_minutes * MIN;
  const warnings = [];

  // Optional flexible window: preferred_end_time later than start + duration.
  let windowEndMs = endMs;
  if (j.preferred_end_time) {
    const we = zonedToUtc(j.preferred_date, j.preferred_end_time, tz);
    if (we !== null && we > endMs) windowEndMs = we;
    else if (we !== null && we < endMs) warnings.push(`preferred_end_time ${j.preferred_end_time} is shorter than the requested ${j.requested_duration_minutes} min; duration wins`);
  }
  if (!withinRequesterDay(startMs, endMs, tz, cfg)) {
    warnings.push(`requested time is ${zonedParts(startMs, tz).time} in the requester's timezone (outside ${cfg.requester_day_start}–${cfg.requester_day_end} local)`);
  }

  const nowMs = referenceNow(cfg);
  const horizon = Number(cfg.search_horizon_days) || 10;
  const bizDate = zonedParts(startMs, businessTz).date;
  j.requested_start_utc = toIsoUtc(startMs);
  j.requested_end_utc = toIsoUtc(endMs);
  j.requested_time_utc = `${toIsoUtc(startMs)} → ${toIsoUtc(endMs)}`;
  j.requested_time_local = rangeLabel(startMs, endMs, tz);
  j.requested_time_business = rangeLabel(startMs, endMs, businessTz);
  j.requested_business_date = bizDate;
  j.preferred_window = { start_utc: toIsoUtc(startMs), end_utc: toIsoUtc(windowEndMs), flexible: windowEndMs > endMs };
  j.alternative_business_dates = (j.alternative_dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  // Used by the production free/busy query.
  j.search_window_start_utc = toIsoUtc(Math.min(nowMs, startMs));
  j.search_window_end_utc = toIsoUtc(zonedToUtc(addDays(bizDate, horizon), '23:59', businessTz));
  j.timezone_normalization = {
    status: 'ok',
    requester_offset: tzAbbrev(startMs, tz),
    business_offset: tzAbbrev(startMs, businessTz),
    offset_difference_minutes: tzOffsetMinutes(startMs, businessTz) - tzOffsetMinutes(startMs, tz),
    warnings,
  };
  out.push({ json: j, pairedItem: { item: i } });
}
return out;
