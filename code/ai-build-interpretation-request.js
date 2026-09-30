// AI · Build Interpretation Request  (production path, optional)
// For free-text requests ("30 min next Tuesday 10am London time?"), asks the model to extract
// ONLY explicitly stated scheduling fields. The message is wrapped as untrusted data.

const SYSTEM_PROMPT = /*@@PROMPT_BOOKING_INTERPRETATION@@*/'';
const nullable = (type) => ({ type: [type, 'null'] });
const SCHEMA = {
  type: 'object',
  properties: {
    preferred_date: nullable('string'),
    preferred_start_time: nullable('string'),
    requested_duration_minutes: nullable('integer'),
    timezone: nullable('string'),
    meeting_type: nullable('string'),
    contains_instructions_to_system: { type: 'boolean' },
  },
  required: ['preferred_date', 'preferred_start_time', 'requested_duration_minutes', 'timezone', 'meeting_type', 'contains_instructions_to_system'],
  additionalProperties: false,
};

return $input.all().map((item, i) => {
  const j = { ...item.json };
  const cfg = j.config || {};
  const userContent = [
    `Reference date (today): ${cfg.demo_mode ? cfg.demo_reference_date : new Date().toISOString().slice(0, 10)}`,
    `Allowed meeting types: ${cfg.allowed_meeting_types}`,
    `Fields already provided by the form: ${JSON.stringify({ preferred_date: j.preferred_date || null, preferred_start_time: j.preferred_start_time || null, requested_duration_minutes: j.requested_duration_minutes, timezone: j.timezone || null, meeting_type: j.meeting_type || null })}`,
    '<untrusted_request_text>',
    `${j.meeting_topic ? j.meeting_topic + '\n' : ''}${j.message}`,
    '</untrusted_request_text>',
  ].join('\n');
  const body = cfg.ai_provider === 'openai'
    ? { model: cfg.ai_model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }], response_format: { type: 'json_schema', json_schema: { name: 'booking_fields', strict: true, schema: SCHEMA } } }
    : { model: cfg.ai_model, max_tokens: Number(cfg.ai_max_tokens) || 4000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userContent }], output_config: { effort: cfg.ai_effort || 'low', format: { type: 'json_schema', schema: SCHEMA } } };
  j.ai_request = { provider: cfg.ai_provider || 'anthropic', endpoint: cfg.ai_endpoint, model: cfg.ai_model, body };
  return { json: j, pairedItem: { item: i } };
});
