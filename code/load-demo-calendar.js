// DEMO · Load Calendar Availability
// Offline stand-in for a calendar free/busy lookup. The fictional calendar from
// test-data/demo-calendar.json is embedded at build time; no network access.
// Output shape matches "Calendar · Map Free/Busy" (production) so downstream logic is identical.
// @include _shared/time-utils.js

const DEMO_CALENDAR = /*@@DEMO_CALENDAR@@*/{};

const items = $input.all();
const cfg = (items[0] && items[0].json.config) || {};
const tz = DEMO_CALENDAR.business_timezone;
const busy = (DEMO_CALENDAR.events || []).map((ev) => ({
  id: ev.id,
  title: ev.title,
  kind: ev.kind,
  start_utc: toIsoUtc(zonedToUtc(ev.date, ev.start, tz)),
  end_utc: toIsoUtc(zonedToUtc(ev.date, ev.end, tz)),
}));
const availability = {
  status: 'ok',
  source: 'demo-calendar.json (fictional, offline)',
  calendar_id: DEMO_CALENDAR._meta.calendar_id,
  business_timezone: tz,
  business_days: DEMO_CALENDAR.business_hours.days,
  business_hours: { start: DEMO_CALENDAR.business_hours.start, end: DEMO_CALENDAR.business_hours.end },
  recurring_blocks: DEMO_CALENDAR.recurring_blocks,
  coverage: DEMO_CALENDAR._meta.coverage,
  busy,
  consistency_check: tz === cfg.business_timezone ? 'business timezone matches Config' : `WARNING: calendar timezone ${tz} differs from Config ${cfg.business_timezone}`,
};

return items.map((it, i) => ({ json: { ...it.json, availability }, pairedItem: { item: i } }));
