// AI · Apply Draft (guardrails)  (production path)
// Takes ONLY subject/body text from the model. Booking status, slots, priority and flags are never
// read from the AI response. Any failure or guardrail violation falls back to the deterministic template.
// If "AI · Draft Booking Message" is disabled, items pass through here and use the template.
// @include _shared/time-utils.js
// @include _shared/draft-templates.js

const URL_RE = /https?:\/\/|www\./i;
const PRICE_RE = /[$€£¥]\s?\d|\b\d+(?:[.,]\d+)?\s?(usd|eur|gbp|dollars?|euros?)\b|\b(price|pricing|discount|fee|invoice)\b/i;
const LINK_RE = /zoom\.us|meet\.google|teams\.microsoft|webex\.com/i;
const PROMISE_RE = /\b(guarantee[ds]?|promise[ds]?|100%)\b/i;

function extractText(resp) {
  if (!resp || typeof resp !== 'object') return { error: 'empty response' };
  if (resp.error) return { error: `provider error: ${String(resp.error.message || resp.error).slice(0, 160)}` };
  if (resp.stop_reason === 'refusal') return { error: 'model refused' };
  if (Array.isArray(resp.content)) { // Anthropic Messages API
    if (resp.stop_reason === 'max_tokens') return { error: 'response truncated (max_tokens)' };
    const block = resp.content.find((b) => b.type === 'text');
    return block ? { text: block.text } : { error: 'no text block' };
  }
  if (Array.isArray(resp.choices)) { // OpenAI-compatible
    const msg = resp.choices[0] && resp.choices[0].message;
    return msg && msg.content ? { text: msg.content } : { error: 'no message content' };
  }
  return { error: 'unrecognized response shape' };
}

function guardrails(draft, j) {
  const v = [];
  if (!draft || typeof draft.subject !== 'string' || typeof draft.body !== 'string') return ['draft is not {subject, body}'];
  if (draft.subject.length > 160) v.push('subject too long');
  if (draft.body.length < 40 || draft.body.length > 3000) v.push('body length out of bounds');
  const all = `${draft.subject}\n${draft.body}`;
  if (URL_RE.test(all)) v.push('contains a URL');
  if (LINK_RE.test(all)) v.push('contains a real meeting-platform link');
  if (PRICE_RE.test(all)) v.push('mentions prices or fees');
  if (PROMISE_RE.test(all)) v.push('makes guarantees');
  if (/\{\{(?!MEETING_LINK|OFFICE_ADDRESS|SENDER_NAME|COMPANY_NAME)[^}]*\}\}/.test(all)) v.push('unknown placeholder');
  const mustMention = j.booking_status === 'READY_TO_CONFIRM' && j.selected_slot ? [j.selected_slot.local || j.selected_slot.business]
    : (j.candidate_slots || []).map((c) => c.local || c.business);
  for (const label of mustMention) {
    const time = (/(\d{2}:\d{2})/.exec(label) || [])[1];
    if (time && !all.includes(time)) v.push(`missing slot time ${time}`);
  }
  if (j.booking_status !== 'READY_TO_CONFIRM' && /\b(is|are) (now )?(confirmed|booked)\b/i.test(all)) v.push('claims a booking is confirmed');
  return v;
}

return $input.all().map((item, i) => {
  const resp = item.json || {};
  let j; let aiOutcome;
  if (resp.booking_id && resp.config) {
    j = { ...resp };
    aiOutcome = { error: 'AI node disabled or skipped' };
  } else {
    j = { ...$('AI · Build Draft Request').itemMatching(i).json };
    aiOutcome = extractText(resp);
  }
  let draft = null; let violations = [];
  if (aiOutcome.text) {
    try { draft = JSON.parse(aiOutcome.text); } catch (e) { violations = ['response is not valid JSON']; }
    if (draft) violations = guardrails(draft, j);
  }
  const useAi = draft && violations.length === 0;
  const finalDraft = useAi ? { subject: draft.subject.trim(), body: draft.body.trim() } : buildTemplateDraft(j);
  j.confirmation_subject = finalDraft ? finalDraft.subject : null;
  j.confirmation_body = finalDraft ? finalDraft.body : null;
  j.draft_source = useAi ? `ai (${j.ai_request.provider})` : `template_fallback (${aiOutcome.error || violations.join('; ')})`;
  j.model = useAi ? j.ai_request.model : `template-fallback (configured: ${(j.config || {}).ai_model})`;
  j.draft_guardrail_violations = violations;
  j.draft_status = finalDraft ? 'DRAFT_ONLY · NOT SENT · human approval required' : 'NO_DRAFT';
  j.draft_placeholders = finalDraft ? PLACEHOLDERS.filter((p) => finalDraft.body.includes(p)) : [];
  delete j.ai_request;
  return { json: j, pairedItem: { item: i } };
});
