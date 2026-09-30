// Build Final Booking Record
// Flattens the pipeline state into one clean record per request, ready for a calendar, CRM,
// scheduling platform or log table. Internal working data (config, availability, rankings) is dropped.
// @include _shared/time-utils.js
// @include _shared/availability-utils.js

const PROCESSING_STATUS = {
  READY_TO_CONFIRM: 'DRAFT_READY · awaiting human send',
  PROPOSE_ALTERNATIVE: 'DRAFT_READY · awaiting human send',
  NO_AVAILABILITY: 'DRAFT_READY · awaiting human send',
  CANCELLED: 'DRAFT_READY · awaiting human approval',
  NEEDS_REVIEW: 'AWAITING_HUMAN_REVIEW',
  INVALID: 'CLOSED · no action',
  DUPLICATE: 'CLOSED · linked to original',
};

const items = $input.all();
const records = items.map((item, i) => {
  const j = item.json;
  const cfg = j.config || {};
  const record = {
    booking_id: j.booking_id,
    scenario: j.scenario,
    timestamp: j.timestamp,
    processed_at: toIsoUtc(referenceNow(cfg)),
    booking_status: j.booking_status,
    status_label: j.status_label,
    review_reason: j.review_reason,
    booking_priority: j.booking_priority,
    priority_reasons: j.priority_reasons,
    full_name: j.full_name,
    email: j.email,
    phone: j.phone,
    company: j.company,
    role: j.role,
    meeting_type: j.meeting_type,
    meeting_topic: j.meeting_topic,
    request_action: j.request_action,
    original_booking_id: j.original_booking_id || null,
    requested_duration_minutes: j.requested_duration_minutes,
    requester_timezone: j.requester_timezone,
    canonical_timezone: j.canonical_timezone,
    business_timezone: j.business_timezone,
    requested_time_local: j.requested_time_local || null,
    requested_time_utc: j.requested_time_utc || null,
    requested_time_business: j.requested_time_business || null,
    requested_slot_available: j.requested_slot_available,
    conflict_detected: j.conflict_detected,
    conflict_reason: j.conflict_reason,
    conflicting_event: j.conflicting_event,
    candidate_slots: j.candidate_slots || [],
    selected_slot_local: j.selected_slot_local,
    selected_slot_utc: j.selected_slot_utc,
    selected_slot_business: j.selected_slot ? j.selected_slot.business : null,
    selected_slot_start_utc: j.selected_slot ? j.selected_slot.start_utc : null,
    selected_slot_end_utc: j.selected_slot ? j.selected_slot.end_utc : null,
    selected_time_local: j.selected_time_local,
    selected_time_utc: j.selected_time_utc,
    selected_slot_reason: j.selected_slot_reason,
    duplicate_of: j.duplicate && j.duplicate.is_duplicate ? j.duplicate.duplicate_of : null,
    missing_fields: j.validation.missing_fields,
    invalid_fields: j.validation.invalid_fields,
    validation_warnings: [...j.validation.warnings, ...((j.timezone_normalization && j.timezone_normalization.warnings) || [])],
    security_flags: j.security.matched_signals,
    ai_inferred_fields: (j.ai_interpretation && j.ai_interpretation.ai_inferred_fields) || [],
    owner: j.owner,
    owner_team: j.owner_team,
    sla: j.sla,
    requires_confirmation: j.requires_confirmation,
    confirmation_subject: j.confirmation_subject || null,
    confirmation_body: j.confirmation_body || null,
    draft_status: j.draft_status || 'NO_DRAFT',
    draft_source: j.draft_source || null,
    recommended_action: j.recommended_action,
    decision_trace: j.decision_trace,
    source: j.source,
    intake_channel: j.intake_channel,
    status: PROCESSING_STATUS[j.booking_status] || 'AWAITING_HUMAN_REVIEW',
    // Calendar writes need all of: production mode, writes enabled in Config, and explicit human approval.
    human_approved: false,
    calendar_writes_enabled: !!cfg.calendar_writes_enabled,
    scheduling_links_enabled: !!cfg.scheduling_links_enabled,
    calendar_event_id: j.cancelled_booking ? j.cancelled_booking.calendar_event_id : null,
    calendar_id: cfg.calendar_id,
    demo_mode: !!cfg.demo_mode,
    model: j.model || (cfg.demo_mode ? 'none (no draft needed)' : cfg.ai_model),
    raw_request: j.raw_request,
  };
  return { json: record, pairedItem: { item: i } };
});
// Stable, readable order for screenshots and logs.
records.sort((a, b) => String(a.json.booking_id).localeCompare(String(b.json.booking_id)));
return records;
