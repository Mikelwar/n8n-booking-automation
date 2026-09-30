// Summary · Run Report
// One-item overview of the run for screenshots, logs and quick sanity checks.

const items = $input.all().map((i) => i.json);
const byStatus = {};
for (const r of items) byStatus[r.booking_status] = (byStatus[r.booking_status] || 0) + 1;

return [{
  json: {
    run_mode: items.length && items[0].demo_mode ? 'DEMO (offline · fictional data · mock AI)' : 'PRODUCTION',
    processed_at: items.length ? items[0].processed_at : null,
    requests_processed: items.length,
    by_status: byStatus,
    overview: items.map((r) => `${r.booking_id} · ${r.status_label} · ${r.full_name || '(no name)'} · ${r.selected_slot_local || (r.duplicate_of && `duplicate of ${r.duplicate_of}`) || (r.original_booking_id && `cancels ${r.original_booking_id}`) || r.review_reason || ''}`),
    drafts_prepared: items.filter((r) => r.confirmation_body).length,
    messages_sent: 0,
    calendar_write_eligible: items.filter((r) => !r.demo_mode && r.calendar_writes_enabled && r.human_approved && ["READY_TO_CONFIRM", "CANCELLED"].includes(r.booking_status)).length,
    safety: {
      drafts_are_never_sent: true,
      calendar_writes_require: 'production mode + calendar_writes_enabled + human_approved',
      confirmed_slots_checked_against_calendar: items.filter((r) => r.booking_status === 'READY_TO_CONFIRM').every((r) => r.requested_slot_available === true || /window/.test(r.selected_slot_reason || '')),
    },
  },
  pairedItem: { item: 0 },
}];
