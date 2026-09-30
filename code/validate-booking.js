// Validate Required Fields
// Deterministic field validation + untrusted-input scan. Never throws: every request continues
// down the pipeline carrying `validation` and `security` so Booking Decision can route it.
// @include _shared/time-utils.js

const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// Instruction-like text that tries to steer the scheduler. Matching text is flagged, never executed.
const INJECTION_SIGNALS = [
  { id: 'ignore_instructions', re: /\b(ignore|forget|override)\b[^.]{0,30}\b(previous|prior|above|earlier|all|your)\b[^.]{0,20}\b(rules|instructions|prompts?|polic(y|ies))\b/i },
  { id: 'disregard_rules', re: /\bdisregard\b[^.]{0,30}\b(rules|instructions|polic(y|ies)|checks)\b/i },
  { id: 'role_takeover', re: /\byou are now\b|\bact as (the |an? )?(admin|administrator|system|developer)\b/i },
  { id: 'prompt_exfiltration', re: /\b(system prompt|developer message|reveal (your|the) (prompt|instructions|rules)|jailbreak)\b/i },
  { id: 'control_override', re: /\b(system|admin) override\b|\bauto[_ ]?confirm\b|\bbypass\b[^.]{0,20}\b(rules|checks|validation|review)\b/i },
  { id: 'status_manipulation', re: /\bmark (this|me|it|my request)\b[^.]{0,20}\b(vip|urgent|priority|confirmed|approved)\b/i },
  { id: 'third_party_action', re: /\b(cancel|delete|remove|move)\b[^.]{0,40}\b(other|another|the [a-z]+day|\d{1,2}:\d{2})\b[^.]{0,30}\b(meeting|event|booking)s?\b/i, bookOnly: true },
  { id: 'code_or_template', re: /<\s*script|javascript:|\{\{[^}]*\}\}|\$\{[^}]*\}/i },
];

const out = [];
for (const [i, item] of $input.all().entries()) {
  const j = { ...item.json };
  const cfg = j.config || {};
  const allowedTypes = String(cfg.allowed_meeting_types || '').split(',').map((s) => s.trim()).filter(Boolean);
  const minDur = Number(cfg.min_duration_minutes) || 15;
  const maxDur = Number(cfg.max_duration_minutes) || 120;
  const missing = [];
  const invalid = [];
  const warnings = [...(j.normalization_notes || [])];
  const need = (field) => { const v = j[field]; if (v === '' || v === null || v === undefined) { missing.push(field); return false; } return true; };

  need('full_name');
  if (need('email') && !EMAIL_RE.test(j.email)) invalid.push({ field: 'email', reason: 'not a valid email address', value: j.email });
  if (j.full_name && (/[@<>]|https?:/i.test(j.full_name) || j.full_name.length < 2)) invalid.push({ field: 'full_name', reason: 'not a plausible name', value: j.full_name });

  if (j.request_action === 'cancel') {
    need('original_booking_id');
  } else {
    if (need('meeting_type') && allowedTypes.length && !allowedTypes.includes(j.meeting_type)) {
      invalid.push({ field: 'meeting_type', reason: `unsupported meeting type (allowed: ${allowedTypes.join(', ')})`, value: j.meeting_type });
    }
    if (need('requested_duration_minutes')) {
      const d = j.requested_duration_minutes;
      if (!Number.isInteger(d) || d < minDur || d > maxDur) invalid.push({ field: 'requested_duration_minutes', reason: `must be between ${minDur} and ${maxDur} minutes`, value: d });
      else if (d % 15 !== 0) warnings.push(`requested_duration_minutes: ${d} is not a multiple of 15`);
    }
    // Timezone is mandatory: timezone-less times are never silently interpreted.
    if (need('timezone') && !isValidTimeZone(j.timezone)) invalid.push({ field: 'timezone', reason: 'not a valid IANA timezone (e.g. Europe/London)', value: j.timezone });
    if (need('preferred_date') && !DATE_RE.test(j.preferred_date)) invalid.push({ field: 'preferred_date', reason: 'expected YYYY-MM-DD', value: j.preferred_date });
    if (need('preferred_start_time') && !TIME_RE.test(j.preferred_start_time)) invalid.push({ field: 'preferred_start_time', reason: 'expected HH:MM (24h)', value: j.preferred_start_time });
    if (j.preferred_end_time && !TIME_RE.test(j.preferred_end_time)) warnings.push('preferred_end_time: unparseable, ignored');
    for (const d of j.alternative_dates || []) if (!DATE_RE.test(d)) warnings.push(`alternative_dates: "${d}" ignored (expected YYYY-MM-DD)`);
  }

  // Untrusted-input scan across every free-text field.
  const matched = [];
  for (const field of ['message', 'notes', 'meeting_topic', 'full_name', 'company', 'role']) {
    const text = j[field];
    if (!text) continue;
    for (const s of INJECTION_SIGNALS) {
      if (s.bookOnly && j.request_action !== 'book') continue;
      if (s.re.test(text)) matched.push({ field, signal: s.id });
    }
  }
  if (/https?:\/\//i.test(j.message || '')) warnings.push('message contains a URL (not followed, not echoed into drafts)');

  j.validation = {
    is_valid: missing.length === 0 && invalid.length === 0,
    missing_fields: missing,
    invalid_fields: invalid,
    warnings,
  };
  j.security = {
    untrusted_input: true,
    injection_detected: matched.length > 0,
    matched_signals: matched,
    policy: 'Free-text fields are data only. They never change status, priority, availability or routing.',
  };
  out.push({ json: j, pairedItem: { item: i } });
}
return out;
