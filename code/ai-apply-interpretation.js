// AI · Apply Interpretation (guarded)  (production path, optional)
// Fills ONLY empty scheduling fields, and only with values that pass local format checks.
// AI can never overwrite a field the requester provided, change urgency/priority, or clear flags.
// Every AI-filled field is listed in `ai_inferred_fields` and must be confirmed with the requester.

const CHECKS = {
  preferred_date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  preferred_start_time: (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v),
  requested_duration_minutes: (v) => Number.isInteger(v) && v >= 5 && v <= 480,
  timezone: (v) => { try { return typeof v === 'string' && /\//.test(v) && !!new Intl.DateTimeFormat('en-US', { timeZone: v }); } catch (e) { return false; } },
  meeting_type: (v) => typeof v === 'string' && /^[a-z_]{3,40}$/.test(v),
};

function parse(resp) {
  if (!resp || resp.error || resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') return null;
  let text = null;
  if (Array.isArray(resp.content)) { const b = resp.content.find((x) => x.type === 'text'); text = b && b.text; }
  else if (Array.isArray(resp.choices)) text = resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}

return $input.all().map((item, i) => {
  const resp = item.json || {};
  const passthrough = resp.booking_id && resp.config;
  const j = passthrough ? { ...resp } : { ...$('AI · Build Interpretation Request').itemMatching(i).json };
  const parsed = passthrough ? null : parse(resp);
  const filled = [];
  if (parsed) {
    for (const [field, ok] of Object.entries(CHECKS)) {
      const current = j[field];
      if ((current === '' || current === null || current === undefined) && parsed[field] !== null && ok(parsed[field])) {
        j[field] = parsed[field];
        filled.push(field);
      }
    }
  }
  j.ai_interpretation = {
    status: passthrough ? 'skipped (AI node disabled)' : parsed ? 'applied' : 'failed (kept original fields)',
    ai_inferred_fields: filled,
    model_reported_instructions_in_text: parsed ? !!parsed.contains_instructions_to_system : null,
    note: 'AI-inferred fields must be confirmed with the requester; they never bypass validation.',
  };
  if (filled.length) j.normalization_notes = [...(j.normalization_notes || []), `AI-inferred (confirm with requester): ${filled.join(', ')}`];
  delete j.ai_request;
  return { json: j, pairedItem: { item: i } };
});
