// ---- shared draft templates (inlined by scripts/build-workflow.js; requires time-utils) ----
// Deterministic, professional drafts. Only structured, validated fields are used; the requester's
// free-text message is never echoed. Placeholders are left for the human sender to fill in.
const TYPE_LABELS = {
  consultation: 'consultation', product_demo: 'product demo', sales_meeting: 'sales conversation',
  client_escalation: 'escalation call', onboarding: 'onboarding session', support_session: 'support session',
  quarterly_review: 'quarterly business review', internal_sync: 'internal sync', general_inquiry: 'introductory call',
};
const MISSING_HELP = {
  timezone: 'your time zone (for example Europe/London or America/New_York)',
  requested_duration_minutes: 'how long you would like the meeting to be (for example 30 or 60 minutes)',
  full_name: 'your full name',
  meeting_type: 'what kind of meeting you need (for example consultation or product demo)',
  preferred_date: 'a preferred date (YYYY-MM-DD)',
  preferred_start_time: 'a preferred start time',
  original_booking_id: 'your booking reference',
};
const PLACEHOLDERS = ['{{MEETING_LINK}}', '{{OFFICE_ADDRESS}}', '{{SENDER_NAME}}', '{{COMPANY_NAME}}'];

function safeTopic(t) {
  return String(t || '').replace(/https?:\/\/\S+/gi, '').replace(/[{}<>$`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function firstName(n) { return (String(n || '').trim().split(/\s+/)[0] || 'there'); }
function typeLabel(t) { return TYPE_LABELS[t] || 'meeting'; }
function locationLine(pref) {
  if (pref === 'in_person') return 'In person at {{OFFICE_ADDRESS}}';
  if (pref === 'phone') return 'Phone call (we will call the number you provided)';
  return 'Video call, joining link: {{MEETING_LINK}}';
}
function whenLines(slot, j) {
  const lines = [`  When:      ${slot.local || slot.business}`];
  const btz = j.business_timezone;
  if (j.timezone && btz && j.timezone !== btz && slot.start_utc) {
    const bs = Date.parse(slot.start_utc); const be = Date.parse(slot.end_utc);
    const b = zonedParts(bs, btz);
    const dayPrefix = b.date !== zonedParts(bs, j.timezone).date ? `${b.weekday} ` : '';
    lines.push(`             (${dayPrefix}${b.time}–${zonedParts(be, btz).time} ${tzAbbrev(bs, btz)} in our office time zone, ${btz})`);
  }
  return lines;
}
function signature() { return 'Best regards,\n{{SENDER_NAME}}\n{{COMPANY_NAME}}'; }

function buildTemplateDraft(j) {
  const name = firstName(j.full_name);
  const label = typeLabel(j.meeting_type);
  const topic = safeTopic(j.meeting_topic);
  const topicLine = topic ? `  Topic:     ${topic}` : null;
  const priority = j.booking_priority === 'HIGH';

  switch (j.booking_status) {
    case 'READY_TO_CONFIRM': {
      const s = j.selected_slot;
      const st = Date.parse(s.start_utc); const tzv = isValidTimeZone(j.timezone) ? j.timezone : j.business_timezone; const zp = zonedParts(st, tzv);
      const shortWhen = `${zp.weekday} ${zp.day} ${MONTHS[zp.month - 1]}, ${zp.time} ${tzAbbrev(st, tzv)}`;
      return {
        subject: `Please confirm: ${label} on ${shortWhen}`,
        body: [
          `Hi ${name},`, '',
          priority ? 'Thank you for flagging this. We have prioritised your request and reserved the following time for you:'
                   : 'Thank you for reaching out. Your preferred time is available and we have reserved it for you while you confirm:',
          '',
          `  Meeting:   ${label.charAt(0).toUpperCase() + label.slice(1)}`,
          topicLine,
          ...whenLines(s, j),
          `  Duration:  ${j.requested_duration_minutes} minutes`,
          `  Where:     ${locationLine(j.location_preference)}`,
          '',
          'Please reply to confirm and we will send the calendar invitation. If anything changes, just let us know.',
          '', signature(),
        ].filter((l) => l !== null).join('\n'),
      };
    }
    case 'PROPOSE_ALTERNATIVE':
    case 'NO_AVAILABILITY': {
      const noDay = j.booking_status === 'NO_AVAILABILITY';
      const requested = j.requested_time_local || 'your requested time';
      const opts = (j.candidate_slots || []).map((c) => `  Option ${c.option}: ${c.local || c.business}`);
      const intro = noDay
        ? `Thank you for your request. Unfortunately we have no availability on ${requested.split(',')[0]}, the day you asked for.`
        : `Thank you for your request. Unfortunately your preferred time, ${requested}, is no longer available.`;
      const lead = priority ? 'We understand this is time-sensitive, so here are the earliest times we can offer:' : 'Here are the closest times we can offer instead:';
      return {
        subject: priority ? `Priority: time options for your ${label}` : noDay ? `Availability update for your ${label} request` : `New time options for your ${label}`,
        body: [
          `Hi ${name},`, '', intro, '',
          ...(opts.length ? [lead, '', ...opts, '', `Each option is ${j.requested_duration_minutes} minutes. Please reply with the option number that suits you. Nothing is booked until you confirm.`,
            'If none of these work, send us two or three times that suit you and we will do our best to fit them in.']
            : ['We are checking additional availability and will come back to you shortly with new options.']),
          '', signature(),
        ].join('\n'),
      };
    }
    case 'NEEDS_REVIEW': {
      if (j.review_reason !== 'INCOMPLETE') return null;
      const asks = (j.validation.missing_fields || []).map((f) => `  • ${MISSING_HELP[f] || f}`);
      return {
        subject: `A few details needed to schedule your ${label}`,
        body: [`Hi ${name},`, '', 'Thank you for getting in touch. To find a time that works for you, could you please send us:', '', ...asks, '',
          'As soon as we have these details we will confirm a time with you.', '', signature()].join('\n'),
      };
    }
    case 'CANCELLED': {
      const b = j.cancelled_booking || {};
      let when = '';
      if (b.date && b.start && j.business_timezone) {
        const ms = zonedToUtc(b.date, b.start, j.business_timezone); const me = zonedToUtc(b.date, b.end, j.business_timezone);
        if (ms !== null) when = `, ${rangeLabel(ms, me, isValidTimeZone(j.timezone) ? j.timezone : j.business_timezone)}`;
      }
      return {
        subject: `We have received your cancellation request (${b.booking_id || j.original_booking_id})`,
        body: [`Hi ${name},`, '', `Thank you for letting us know. We have received your request to cancel booking ${b.booking_id || j.original_booking_id} (${label}${when}).`, '',
          'A member of our team will confirm the cancellation shortly. Whenever you are ready to rebook, simply reply to this email.', '', signature()].join('\n'),
      };
    }
    default:
      return null;
  }
}
// ---- end shared draft templates ----
