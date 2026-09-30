// Calendar · Map Free/Busy  (production path)
// Converts a Google Calendar free/busy response into the same `availability` shape the demo loader
// produces. If the calendar node is disabled or failed, items arrive unchanged and availability is
// marked `not_connected` → Booking Decision routes them to NEEDS_REVIEW (fail safe, never books blind).
// @include _shared/time-utils.js

const out = [];
for (const [i, item] of $input.all().entries()) {
  const resp = item.json || {};
  let booking;
  if (resp.booking_id && resp.config) {
    booking = resp; // calendar node disabled → pass-through item
  } else {
    try { booking = $('Normalize Timezone').itemMatching(i).json; } catch (e) { booking = null; }
  }
  if (!booking) { out.push({ json: { ...resp, availability: { status: 'error', reason: 'could not pair calendar response with booking' } }, pairedItem: { item: i } }); continue; }
  const cfg = booking.config || {};

  const calendars = resp.calendars || (resp.raw && resp.raw.calendars) || null;
  let availability;
  if (!calendars) {
    availability = {
      status: 'not_connected',
      reason: resp.error ? `calendar error: ${String(resp.error.message || resp.error).slice(0, 200)}` : 'Calendar · Check Availability is disabled or returned no free/busy data',
    };
  } else {
    const busy = [];
    for (const [calId, cal] of Object.entries(calendars)) {
      if (cal.errors && cal.errors.length) { availability = { status: 'error', reason: `calendar ${calId} returned errors` }; break; }
      for (const [n, b] of (cal.busy || []).entries()) {
        busy.push({ id: `BUSY-${n + 1}`, title: 'Busy (private)', kind: 'external', start_utc: toIsoUtc(Date.parse(b.start)), end_utc: toIsoUtc(Date.parse(b.end)) });
      }
    }
    availability = availability || {
      status: 'ok',
      source: 'google_calendar_freebusy',
      calendar_id: cfg.calendar_id,
      business_timezone: cfg.business_timezone,
      business_days: String(cfg.business_days || 'Mon,Tue,Wed,Thu,Fri').split(',').map((s) => s.trim()),
      business_hours: { start: cfg.business_hours_start, end: cfg.business_hours_end },
      recurring_blocks: cfg.lunch_start ? [{ label: 'Lunch break (blocked)', days: String(cfg.business_days).split(',').map((s) => s.trim()), start: cfg.lunch_start, end: cfg.lunch_end }] : [],
      coverage: booking.search_window_start_utc ? { from: booking.search_window_start_utc.slice(0, 10), to: booking.search_window_end_utc.slice(0, 10) } : null,
      busy,
    };
  }
  out.push({ json: { ...booking, availability }, pairedItem: { item: i } });
}
return out;
