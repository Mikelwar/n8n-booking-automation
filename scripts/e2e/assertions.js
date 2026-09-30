// Shared assertions for the demo + production-mode runs.
// Used by scripts/e2e/assert-results.js (real n8n output) and scripts/test-offline.js (offline executor).
'use strict';
const fs = require('fs');
const path = require('path');

function runAssertions({ root, demo, prod, outDir, label }) {
  let failures = 0; let passes = 0;
  const ok = (cond, msg) => { if (cond) { passes++; console.log(`  PASS  ${msg}`); } else { failures++; console.log(`  FAIL  ${msg}`); } };
  console.log(`\n######## ${label}`);
  const out = (rd, name, output = 0, run = 0) => {
    const r = rd.runData[name];
    if (!r || !r[run] || !r[run].data) return null;
    return (r[run].data.main[output] || []).map((x) => x.json);
  };

  const wf = JSON.parse(fs.readFileSync(path.join(root, 'workflows/ai-booking-automation.json'), 'utf8'));
  const calendar = JSON.parse(fs.readFileSync(path.join(root, 'test-data/demo-calendar.json'), 'utf8'));
  const EXTERNAL_TYPES = ['n8n-nodes-base.httpRequest', 'n8n-nodes-base.googleCalendar', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.dataTable'];

  // Independent re-check of slots against the demo calendar (Oct 2026 in Europe/Berlin is CEST = UTC+2).
  const toUtc = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+02:00`);
  const busy = calendar.events.map((e) => [toUtc(e.date, e.start), toUtc(e.date, e.end), e.id]);
  function slotProblems(startIso, endIso) {
    const s = Date.parse(startIso); const e = Date.parse(endIso); const p = [];
    const local = new Date(s + 2 * 3600e3).toISOString(); const date = local.slice(0, 10);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) p.push('weekend');
    if (s < toUtc(date, '09:00') || e > toUtc(date, '17:00')) p.push('outside business hours');
    if (s < toUtc(date, '13:00') && e > toUtc(date, '12:00')) p.push('overlaps lunch');
    for (const [bs, be, id] of busy) if (s < be && bs < e) p.push(`overlaps ${id}`);
    return p;
  }

  // ------------------------------------------------------------------ static checks on the JSON
  console.log('\n== Workflow JSON');
  const names = new Set(wf.nodes.map((n) => n.name));
  let danglings = 0;
  for (const [from, c] of Object.entries(wf.connections)) {
    if (!names.has(from)) danglings++;
    for (const o of c.main) for (const t of o) if (!names.has(t.node)) danglings++;
  }
  ok(danglings === 0, 'every connection points to an existing node');
  const functional = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
  const connected = new Set(Object.keys(wf.connections));
  for (const c of Object.values(wf.connections)) for (const o of c.main) for (const t of o) connected.add(t.node);
  ok(functional.every((n) => connected.has(n.name)), 'every functional node is connected');
  ok(wf.nodes.every((n) => !n.credentials), 'no credentials embedded in any node');
  const wfText = JSON.stringify(wf);
  ok(!/sk-ant-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|xox[bp]-|ghp_[A-Za-z0-9]{20,}/.test(wfText), 'no secret-like strings in workflow JSON');
  const extNodes = functional.filter((n) => EXTERNAL_TYPES.includes(n.type));
  ok(extNodes.length >= 9 && extNodes.every((n) => n.disabled === true), `all ${extNodes.length} external integration nodes are disabled`);
  ok(wf.nodes.find((n) => n.name === 'Run Demo').type === 'n8n-nodes-base.manualTrigger', 'manual trigger "Run Demo" exists');
  const cfgAssign = wf.nodes.find((n) => n.name === 'Config').parameters.assignments.assignments;
  ok(cfgAssign.find((a) => a.name === 'config.demo_mode').value === true, 'config.demo_mode = true by default');
  ok(!!cfgAssign.find((a) => a.name === 'config.demo_reference_date'), 'config.demo_reference_date present');

  // ------------------------------------------------------------------ demo run
  console.log('\n== Demo run (demo_mode = true)');
  ok(!demo.error, `execution finished without error${demo.error ? `: ${demo.error.message}` : ''}`);
  const nodeErrors = Object.entries(demo.runData).filter(([, runs]) => runs.some((r) => r.error)).map(([n]) => n);
  ok(nodeErrors.length === 0, `no node errors ${nodeErrors.join(', ')}`);
  const executedExternal = Object.keys(demo.runData).filter((n) => { const node = wf.nodes.find((x) => x.name === n); return node && EXTERNAL_TYPES.includes(node.type) && !node.disabled; });
  ok(executedExternal.length === 0, 'zero enabled external nodes executed (no AI / calendar / CRM / sheet calls)');
  ok(!demo.runData['AI · Build Draft Request'] && !demo.runData['AI · Build Interpretation Request'], 'production AI branches not entered in demo mode');
  ok(!demo.runData['Calendar · Check Availability (Google)'], 'production calendar branch not entered in demo mode');
  for (const n of ['Validate Required Fields', 'Booking Decision', 'Needs Confirmation Draft?', 'Build Final Booking Record']) {
    ok((demo.runData[n] || []).length === 1, `"${n}" ran exactly once (merges consolidate branches)`);
  }

  const records = out(demo, 'Build Final Booking Record') || [];
  const byId = Object.fromEntries(records.map((r) => [r.booking_id, r]));
  ok(records.length === 10, `all 10 demo requests produced a final record (got ${records.length})`);

  const EXPECTED = {
    'BK-1001': ['READY_TO_CONFIRM'], 'BK-1002': ['PROPOSE_ALTERNATIVE', 'HIGH'], 'BK-1003': ['PROPOSE_ALTERNATIVE'],
    'BK-1004': ['NO_AVAILABILITY'], 'BK-1005': ['NEEDS_REVIEW'], 'BK-1006': ['DUPLICATE'], 'BK-1007': ['READY_TO_CONFIRM'],
    'BK-1008': ['NEEDS_REVIEW'], 'BK-1009': ['INVALID'], 'BK-1010': ['CANCELLED'],
  };
  for (const [id, [status, prio]] of Object.entries(EXPECTED)) {
    const r = byId[id] || {};
    ok(r.booking_status === status && (!prio || r.booking_priority === prio), `${id} → ${status}${prio ? ` / ${prio}` : ''} (got ${r.booking_status} / ${r.booking_priority})`);
  }

  // conflicts never booked, holds never overlap, all slots valid against the calendar
  const ready = records.filter((r) => r.booking_status === 'READY_TO_CONFIRM');
  ok(ready.every((r) => r.requested_slot_available === true && r.conflict_detected === false), 'READY_TO_CONFIRM only when the requested slot has no conflict');
  ok(records.filter((r) => r.conflict_detected).every((r) => r.booking_status !== 'READY_TO_CONFIRM'), 'no conflicting request is marked READY_TO_CONFIRM');
  const offered = [];
  for (const r of records) {
    if (r.selected_slot_start_utc && r.booking_status === 'READY_TO_CONFIRM') offered.push([r.booking_id, r.selected_slot_start_utc, r.selected_slot_end_utc]);
    for (const c of r.candidate_slots || []) offered.push([r.booking_id, c.start_utc, c.end_utc]);
  }
  const badSlots = offered.map(([id, s, e]) => [id, s, slotProblems(s, e)]).filter(([, , p]) => p.length);
  ok(badSlots.length === 0, `all ${offered.length} confirmed/proposed slots are inside business hours and conflict-free ${badSlots.map((b) => JSON.stringify(b)).join(' ')}`);
  let overlapsAcross = 0;
  for (let a = 0; a < offered.length; a++) for (let b = a + 1; b < offered.length; b++) {
    if (offered[a][0] !== offered[b][0] && Date.parse(offered[a][1]) < Date.parse(offered[b][2]) && Date.parse(offered[b][1]) < Date.parse(offered[a][2])) overlapsAcross++;
  }
  ok(overlapsAcross === 0, 'no slot is held or offered to two different requests (no double-booking)');
  ok((byId['BK-1003'].candidate_slots || []).length >= 2 && byId['BK-1003'].conflict_detected === true && /EVT-1203/.test(JSON.stringify(byId['BK-1003'].conflicting_event)), 'BK-1003 conflict detected with EVT-1203 and alternatives proposed');
  ok((byId['BK-1002'].candidate_slots || []).length === 3 && /HIGH-priority/.test(byId['BK-1002'].candidate_slots[0].reason), 'BK-1002 (VIP) receives 3 earliest-feasible alternatives');
  ok((byId['BK-1004'].candidate_slots || []).length > 0 && byId['BK-1004'].review_reason === 'REQUESTED_DAY_FULLY_BOOKED' && !byId['BK-1004'].candidate_slots.some((c) => c.business_date === '2026-10-14'), 'BK-1004 fully booked day → next-best options, none on the blocked day');

  // duplicate & incomplete
  const dup = byId['BK-1006'];
  ok(dup.duplicate_of === 'BK-1001' && !dup.selected_slot_utc && dup.candidate_slots.length === 0 && !dup.confirmation_body, 'BK-1006 duplicate references BK-1001, gets no slot, no hold and no draft');
  const inc = byId['BK-1005'];
  ok(inc.review_reason === 'INCOMPLETE' && inc.missing_fields.includes('timezone') && inc.missing_fields.includes('requested_duration_minutes') && /time zone/.test(inc.confirmation_body || ''), 'BK-1005 incomplete → NEEDS_REVIEW with missing fields and an info-request draft');

  // timezone
  const tz = byId['BK-1007'];
  ok(tz.requester_timezone === 'America/New_York' && tz.canonical_timezone === 'UTC' && tz.requested_time_utc.startsWith('2026-10-13T14:15:00Z') && /EDT/.test(tz.selected_slot_local) && /16:15/.test(tz.selected_slot_business), 'BK-1007 10:15 New York → 14:15 UTC → 16:15 Berlin, local view preserved');
  const vip = byId['BK-1002'];
  ok(vip.requested_time_utc.startsWith('2026-10-13T08:30:00Z') && vip.candidate_slots.every((c) => /GMT\+1/.test(c.local)), 'BK-1002 London request normalized (09:30 London → 08:30 UTC), options shown in London local time (GMT+1)');

  // security & invalid
  const inj = byId['BK-1008'];
  ok(inj.review_reason === 'SECURITY_FLAG' && inj.security_flags.length >= 3 && !inj.confirmation_body && inj.booking_priority !== 'HIGH', 'BK-1008 prompt injection flagged → NEEDS_REVIEW, no draft, no priority boost');
  ok(byId['BK-1009'].invalid_fields.some((f) => f.field === 'email') && byId['BK-1009'].invalid_fields.some((f) => f.field === 'requested_duration_minutes'), 'BK-1009 invalid email + duration listed');
  ok(records.every((r) => r.raw_request && typeof r.raw_request === 'object'), 'raw request preserved on every record');

  // drafts
  const drafts = records.filter((r) => r.confirmation_body);
  ok(drafts.length >= 6, `${drafts.length} drafts prepared`);
  ok(drafts.every((r) => /NOT SENT/.test(r.draft_status)), 'every draft is marked DRAFT_ONLY · NOT SENT');
  ok(drafts.every((r) => !/https?:\/\/|zoom\.us|meet\.google/i.test(r.confirmation_body)), 'drafts contain no real links (placeholders only)');
  ok(drafts.every((r) => !/[$€£]\s?\d/.test(r.confirmation_body)), 'drafts contain no prices');
  ok(!drafts.some((r) => /ignore all previous/i.test(r.confirmation_body)), 'requester free text never echoed into drafts');
  ok(records.every((r) => r.demo_mode === true), 'records flagged demo_mode = true');

  // production gate
  const gateOut = (demo.runData['Calendar Write Gate'] || [])[0];
  const gateCount = gateOut ? gateOut.data.main.reduce((n, o) => n + (o ? o.length : 0), 0) : 0;
  ok(gateCount === 0, 'Calendar Write Gate passed 0 items (no event creation possible in demo)');
  const summary = (out(demo, 'Summary · Run Report') || [])[0] || {};
  ok(summary.messages_sent === 0 && summary.calendar_write_eligible === 0, 'run summary: 0 messages sent, 0 calendar writes eligible');

  // ------------------------------------------------------------------ production mode with integrations disabled
  console.log('\n== Production-mode run (demo_mode = false, integrations disabled)');
  ok(!prod.error, `execution finished without error${prod.error ? `: ${prod.error.message}` : ''}`);
  const precs = out(prod, 'Build Final Booking Record') || [];
  const pById = Object.fromEntries(precs.map((r) => [r.booking_id, r]));
  ok(precs.length === 10, 'all 10 requests completed');
  ok(['BK-1001', 'BK-1002', 'BK-1003', 'BK-1004', 'BK-1007'].every((id) => pById[id].booking_status === 'NEEDS_REVIEW' && pById[id].review_reason === 'AVAILABILITY_UNKNOWN'), 'without a connected calendar, schedulable requests fail safe to NEEDS_REVIEW (never confirmed blind)');
  ok(pById['BK-1006'].booking_status === 'DUPLICATE', 'in-batch duplicate still detected without the demo ledger');
  ok(pById['BK-1010'].booking_status === 'NEEDS_REVIEW', 'cancellation without ledger lookup → NEEDS_REVIEW');
  ok(/template_fallback/.test(pById['BK-1005'].draft_source || ''), 'disabled AI draft node → deterministic template fallback');
  ok((prod.runData['Merge · Interpretation Paths'] || []).length === 1 && (prod.runData['Validate Required Fields'] || []).length === 1, 'interpretation branch + merge consolidate into a single validation run');
  ok(precs.every((r) => r.demo_mode === false), 'records flagged demo_mode = false');

  if (outDir) {
    fs.writeFileSync(path.join(outDir, 'demo-final-records.json'), JSON.stringify(records, null, 2));
    fs.writeFileSync(path.join(outDir, 'demo-summary.json'), JSON.stringify(summary, null, 2));
  }
  console.log('\n== Demo results');
  for (const r of records) console.log(`  ${r.booking_id}  ${String(r.status_label).padEnd(34)} ${r.booking_priority.padEnd(6)} ${r.selected_slot_local || r.review_reason || ''}`);
  console.log(`\n${passes} passed, ${failures} failed`);
  return { passes, failures };
}

module.exports = { runAssertions };
