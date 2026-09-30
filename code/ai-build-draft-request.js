// AI · Build Draft Request  (production path)
// Builds a provider-agnostic request for the drafting model. Only engine-produced facts are sent:
// the requester's free-text message is NOT included, so it cannot steer the model.
// Provider, endpoint and model come from Config; the API key lives only in an n8n credential.
// @include _shared/time-utils.js
// @include _shared/draft-templates.js

const SYSTEM_PROMPT = /*@@PROMPT_CONFIRMATION_DRAFT@@*/'';
const SCHEMA = {
  type: 'object',
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
  required: ['subject', 'body'],
  additionalProperties: false,
};

return $input.all().map((item, i) => {
  const j = { ...item.json };
  const cfg = j.config || {};
  const facts = {
    booking_status: j.booking_status,
    review_reason: j.review_reason,
    priority: j.booking_priority,
    requester_first_name: firstName(j.full_name),
    meeting_type: typeLabel(j.meeting_type),
    meeting_topic: safeTopic(j.meeting_topic),
    duration_minutes: j.requested_duration_minutes,
    requester_timezone: j.timezone || null,
    office_timezone: j.business_timezone,
    location: locationLine(j.location_preference),
    requested_time_local: j.requested_time_local || null,
    selected_slot: j.booking_status === 'READY_TO_CONFIRM' && j.selected_slot ? { local: j.selected_slot.local, office: j.selected_slot.business } : null,
    options: (j.candidate_slots || []).map((c) => ({ option: c.option, local: c.local, office: c.business })),
    missing_information: j.review_reason === 'INCOMPLETE' ? (j.validation.missing_fields || []).map((f) => MISSING_HELP[f] || f) : [],
    cancelled_booking_reference: j.cancelled_booking ? j.cancelled_booking.booking_id : null,
    allowed_placeholders: PLACEHOLDERS,
  };
  const userContent = `Booking facts (produced by the scheduling engine, authoritative):\n${JSON.stringify(facts, null, 2)}`;
  let body;
  if (cfg.ai_provider === 'openai') {
    body = {
      model: cfg.ai_model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      response_format: { type: 'json_schema', json_schema: { name: 'booking_draft', strict: true, schema: SCHEMA } },
    };
  } else {
    // Anthropic Messages API (default)
    body = {
      model: cfg.ai_model,
      max_tokens: Number(cfg.ai_max_tokens) || 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      output_config: { effort: cfg.ai_effort || 'low', format: { type: 'json_schema', schema: SCHEMA } },
    };
  }
  j.ai_request = { provider: cfg.ai_provider || 'anthropic', endpoint: cfg.ai_endpoint, model: cfg.ai_model, body };
  return { json: j, pairedItem: { item: i } };
});
