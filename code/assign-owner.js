// Assign Booking Owner / Team
// Deterministic routing table + response SLA. Owners are role-based queues (placeholders), not people.

const TEAM_BY_TYPE = {
  client_escalation: { team: 'Client Success · Escalations', owner: 'Account Director (on-call)' },
  product_demo: { team: 'Sales Engineering', owner: 'Solutions Engineer queue' },
  sales_meeting: { team: 'Sales', owner: 'Account Executive queue' },
  consultation: { team: 'Solutions Consulting', owner: 'Consulting queue' },
  onboarding: { team: 'Customer Onboarding', owner: 'Onboarding queue' },
  support_session: { team: 'Support', owner: 'Support queue' },
  quarterly_review: { team: 'Account Management', owner: 'Account Manager queue' },
};

function route(j) {
  switch (j.booking_status) {
    case 'INVALID': return { team: 'Intake Operations', owner: 'Intake review queue' };
    case 'DUPLICATE': return { team: 'Intake Operations', owner: 'No action (linked to original)' };
    case 'CANCELLED': return { team: 'Account Management', owner: 'Account Manager queue' };
    case 'NEEDS_REVIEW':
      if (j.review_reason === 'SECURITY_FLAG') return { team: 'Security Review', owner: 'Security review queue' };
      return { team: 'Scheduling Coordinators', owner: 'Scheduling coordinator queue' };
    case 'NO_AVAILABILITY': {
      const t = TEAM_BY_TYPE[j.meeting_type] || { team: 'Scheduling Coordinators', owner: 'Scheduling coordinator queue' };
      return { ...t, escalation: 'Capacity check with team lead' };
    }
    default:
      return TEAM_BY_TYPE[j.meeting_type] || { team: 'Scheduling Coordinators', owner: 'Scheduling coordinator queue' };
  }
}

return $input.all().map((item, i) => {
  const j = { ...item.json };
  const cfg = j.config || {};
  const r = route(j);
  const slaMin = Number(cfg[`sla_minutes_${String(j.booking_priority || 'NORMAL').toLowerCase()}`]) || 240;
  const received = Date.parse(j.timestamp);
  j.owner = r.owner;
  j.owner_team = r.team;
  j.owner_escalation = r.escalation || null;
  j.sla = {
    priority: j.booking_priority,
    first_response_within_minutes: slaMin,
    respond_by_utc: Number.isFinite(received) ? new Date(received + slaMin * 60000).toISOString().replace('.000Z', 'Z') : null,
  };
  return { json: j, pairedItem: { item: i } };
});
