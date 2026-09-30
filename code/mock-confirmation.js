// DEMO · Mock Confirmation Draft
// Offline stand-in for the AI drafting step. Produces realistic confirmation / rescheduling /
// missing-information drafts from deterministic templates. No API call, nothing is sent.
// @include _shared/time-utils.js
// @include _shared/draft-templates.js

return $input.all().map((item, i) => {
  const j = { ...item.json };
  const draft = buildTemplateDraft(j);
  j.confirmation_subject = draft ? draft.subject : null;
  j.confirmation_body = draft ? draft.body : null;
  j.draft_source = 'mock_ai_template (demo mode, no API call)';
  j.model = 'mock-draft-template-v1';
  j.draft_status = draft ? 'DRAFT_ONLY · NOT SENT · human approval required' : 'NO_DRAFT';
  j.draft_placeholders = draft ? PLACEHOLDERS.filter((p) => draft.body.includes(p)) : [];
  return { json: j, pairedItem: { item: i } };
});
