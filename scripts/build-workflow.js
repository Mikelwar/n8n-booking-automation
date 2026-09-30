#!/usr/bin/env node
// Builds workflows/ai-booking-automation.json from code/, prompts/ and test-data/.
// Usage: node scripts/build-workflow.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

// ---------------------------------------------------------------- code assembly
function extractSystemPrompt(mdPath) {
  const md = read(mdPath);
  const m = /<!-- SYSTEM_PROMPT_START -->\s*([\s\S]*?)\s*<!-- SYSTEM_PROMPT_END -->/.exec(md);
  if (!m) throw new Error(`No system prompt markers in ${mdPath}`);
  return m[1];
}
const bookings = readJson('test-data/sample-bookings.json').bookings;
const calendar = readJson('test-data/demo-calendar.json');
const SUBSTITUTIONS = {
  DEMO_BOOKINGS: JSON.stringify(bookings, null, 2),
  DEMO_CALENDAR: JSON.stringify(calendar, null, 2),
  DEMO_LEDGER: JSON.stringify(calendar.existing_bookings, null, 2),
  PROMPT_CONFIRMATION_DRAFT: JSON.stringify(extractSystemPrompt('prompts/confirmation-draft.md')),
  PROMPT_BOOKING_INTERPRETATION: JSON.stringify(extractSystemPrompt('prompts/booking-interpretation.md')),
};

function code(file) {
  let src = read(`code/${file}`);
  src = src.replace(/^\/\/ @include (\S+)\s*$/gm, (_, inc) => read(`code/${inc}`).trimEnd());
  src = src.replace(/\/\*@@([A-Z_]+)@@\*\/(\[\]|\{\}|'')/g, (_, key) => {
    if (!(key in SUBSTITUTIONS)) throw new Error(`Unknown placeholder ${key} in ${file}`);
    return SUBSTITUTIONS[key];
  });
  if (/@include|\/\*@@/.test(src)) throw new Error(`Unresolved include/placeholder in ${file}`);
  return src;
}

// ---------------------------------------------------------------- node helpers
const uuid = (seed) => {
  const h = crypto.createHash('sha1').update(`n8n-booking-demo:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const nodes = [];
const node = (name, type, typeVersion, position, parameters, extra = {}) => {
  nodes.push({ parameters, id: uuid(name), name, type, typeVersion, position, ...extra });
  return name;
};
const codeNode = (name, file, position, extra) => node(name, 'n8n-nodes-base.code', 2, position, { jsCode: code(file) }, extra);
const cond = (id, left, operator, right) => ({ id: uuid(`cond:${id}`), leftValue: left, rightValue: right === undefined ? '' : right, operator });
const OP = {
  isTrue: { type: 'boolean', operation: 'true', singleValue: true },
  isFalse: { type: 'boolean', operation: 'false', singleValue: true },
  equals: { type: 'string', operation: 'equals' },
  regex: { type: 'string', operation: 'regex' },
  notEmpty: { type: 'string', operation: 'notEmpty', singleValue: true },
  empty: { type: 'string', operation: 'empty', singleValue: true },
};
const conditions = (list, combinator = 'and') => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: list,
  combinator,
});
const ifNode = (name, position, list, extra) => node(name, 'n8n-nodes-base.if', 2.2, position, { conditions: conditions(list), looseTypeValidation: true, options: {} }, extra);
const sticky = (name, position, width, height, color, content) =>
  node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });

// Production HTTP call to an AI provider: endpoint/model come from Config, key from an n8n credential.
const aiHttp = (name, position, notes) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
  method: 'POST',
  url: '={{ $json.ai_request.endpoint }}',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendHeaders: true,
  headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.ai_request.body) }}',
  options: { timeout: 60000 },
}, { disabled: true, onError: 'continueRegularOutput', notes, notesInFlow: true });

// ---------------------------------------------------------------- layout constants
const Y = 360;      // main pipeline row
const P = 800;      // production row (red band)

// ---------------------------------------------------------------- sticky notes (drawn first = behind nodes)
sticky('Header', [-120, -330], 7300, 330, 7, [
  '# AI Appointment & Booking Automation',
  '**Intake → validation → duplicate check → timezone normalization → availability & conflicts → ranked slots → deterministic booking status → confirmation draft → structured booking record.**',
  '',
  '**Run:** select trigger **Run Demo** → *Execute workflow*. `config.demo_mode = true` (default) runs fully offline on fictional data and a fictional calendar, with mock AI drafts. **No API calls, no emails, no calendar writes.**',
  '',
  '**Statuses:** `READY_TO_CONFIRM` · `PROPOSE_ALTERNATIVE` · `NO_AVAILABILITY` · `DUPLICATE` · `NEEDS_REVIEW` · `INVALID` · `CANCELLED`. The AI only writes wording. Scheduling decisions are rule-based and never overridden by AI or by request text.',
  '',
  '*Demo execution uses fictional calendar availability and mock AI responses. Production paths are ready for calendar, AI, CRM and scheduling integrations.*',
].join('\n'));
sticky('Section 1 · Intake', [-120, 40], 1840, 520, 5, [
  '## 1 · Booking Intake & Demo',
  '**Run Demo** loads 10 fictional requests. **Webhook** accepts real form/API posts (production).',
  'Normalize trims and lowercases input, parses times like "1:15 PM", maps aliases and keeps `raw_request`.',
  '**Config** holds every business rule and the demo reference date (`2026-10-09`), so runs are repeatable.',
].join('\n'));
sticky('Section 2 · Validation', [1740, 40], 1520, 520, 4, [
  '## 2 · Validation, Timezone & Availability',
  'Required fields and formats, plus a **prompt-injection scan** (free text is data, never instructions).',
  'Duplicate key: `email + meeting_type + date + start ±60 min`. Times are converted **requester TZ → UTC**, and the office view is kept.',
  'Demo: fictional calendar. Production: Google free/busy. If availability is unknown the request goes to NEEDS_REVIEW.',
].join('\n'));
sticky('Section 3 · Slots', [3280, 40], 1180, 520, 6, [
  '## 3 · Conflict Resolution & Slot Selection',
  'Feasible slots: business hours, lunch block, 10-min buffers, 12 h notice, reasonable local hours for the requester.',
  'Ranking: requested window → same day → alternative dates → nearest day and time. **HIGH priority = earliest feasible.**',
  'Batch holds prevent double-booking inside a run. Priority changes the order of options, never their validity.',
].join('\n'));
sticky('Section 4 · Draft & Record', [4480, 40], 2720, 520, 2, [
  '## 4 · Confirmation Draft & Booking Record',
  'Drafts for confirm / propose / next-best / missing info / cancellation. **Drafts only, never sent.**',
  'Demo: mock AI template. Production: AI writes wording only, then guardrails check it, with template fallback.',
  'Owner/team + SLA assignment → one clean booking record per request → run summary + webhook response.',
].join('\n'));
sticky('Section 5 · Production', [960, 620], 6240, 700, 3, [
  '## 5 · Production integrations (disabled until configured, no credentials stored in this JSON)',
  'AI interpretation & drafting (provider-agnostic HTTP, model in Config) · Google Calendar free/busy · Data Table / Google Sheets log · CRM upsert · Calendar create / reschedule / cancel · Calendly single-use links.',
  '**Calendar Write Gate** only passes items when `demo_mode = false` AND `calendar_writes_enabled = true` AND `human_approved = true`.',
].join('\n'));

// ---------------------------------------------------------------- 1 · intake
const RUN = node('Run Demo', 'n8n-nodes-base.manualTrigger', 1, [0, 260], {});
const LOAD = codeNode('DEMO · Load Booking Requests', 'load-demo-bookings.js', [220, 260]);
const HOOK = node('Webhook · Receive Booking Request', 'n8n-nodes-base.webhook', 2.1, [0, 460],
  { httpMethod: 'POST', path: 'booking-request', responseMode: 'responseNode', options: {} },
  { webhookId: uuid('webhook-booking-request') });
const NORM = codeNode('Normalize Booking Request', 'normalize-booking.js', [440, Y]);
const CONFIG_VALUES = [
  ['demo_mode', true, 'boolean'],
  ['demo_reference_date', '2026-10-09', 'string'],
  ['demo_reference_time', '17:00', 'string'],
  ['canonical_timezone', 'UTC', 'string'],
  ['business_timezone', 'Europe/Berlin', 'string'],
  ['business_days', 'Mon,Tue,Wed,Thu,Fri', 'string'],
  ['business_hours_start', '09:00', 'string'],
  ['business_hours_end', '17:00', 'string'],
  ['lunch_start', '12:00', 'string'],
  ['lunch_end', '13:00', 'string'],
  ['buffer_minutes', 10, 'number'],
  ['slot_step_minutes', 15, 'number'],
  ['min_notice_hours', 12, 'number'],
  ['search_horizon_days', 10, 'number'],
  ['max_candidate_slots', 3, 'number'],
  ['max_candidates_per_day', 2, 'number'],
  ['min_candidate_spacing_minutes', 60, 'number'],
  ['requester_day_start', '08:00', 'string'],
  ['requester_day_end', '19:00', 'string'],
  ['min_duration_minutes', 15, 'number'],
  ['max_duration_minutes', 120, 'number'],
  ['duplicate_window_minutes', 60, 'number'],
  ['allowed_meeting_types', 'consultation,product_demo,sales_meeting,client_escalation,onboarding,support_session,quarterly_review,internal_sync,general_inquiry', 'string'],
  ['sla_minutes_high', 60, 'number'],
  ['sla_minutes_normal', 240, 'number'],
  ['sla_minutes_low', 1440, 'number'],
  ['ai_provider', 'anthropic', 'string'],
  ['ai_endpoint', 'https://api.anthropic.com/v1/messages', 'string'],
  ['ai_model', 'claude-opus-5', 'string'],
  ['ai_effort', 'low', 'string'],
  ['ai_max_tokens', 4000, 'number'],
  ['calendar_id', 'primary', 'string'],
  ['calendar_writes_enabled', false, 'boolean'],
  ['scheduling_links_enabled', false, 'boolean'],
  ['calendly_event_type_uri', 'https://api.calendly.com/event_types/REPLACE_WITH_EVENT_TYPE_UUID', 'string'],
  ['crm_endpoint', 'https://crm.example.invalid/api/bookings', 'string'],
];
const CONFIG = node('Config', 'n8n-nodes-base.set', 3.4, [660, Y], {
  assignments: { assignments: CONFIG_VALUES.map(([k, v, type]) => ({ id: uuid(`cfg:${k}`), name: `config.${k}`, value: v, type })) },
  includeOtherFields: true,
  options: {},
}, { notes: 'demo_mode = true by default', notesInFlow: true });
const NEEDS_INTERP = ifNode('Needs AI Interpretation?', [880, Y], [
  cond('interp-prod', '={{ $json.config.demo_mode }}', OP.isFalse),
  cond('interp-needed', '={{ $json.needs_interpretation }}', OP.isTrue),
]);
const AI_INTERP_BUILD = codeNode('AI · Build Interpretation Request', 'ai-build-interpretation-request.js', [1040, P]);
const AI_INTERP = aiHttp('AI · Interpret Free-Text Request', [1260, P], 'Disabled · provider-agnostic · key via n8n credential');
const AI_INTERP_APPLY = codeNode('AI · Apply Interpretation (guarded)', 'ai-apply-interpretation.js', [1480, P]);
const MERGE_INTERP = node('Merge · Interpretation Paths', 'n8n-nodes-base.merge', 3.2, [1540, Y], { numberInputs: 2 });

// ---------------------------------------------------------------- 2 · validation / timezone / availability
const VALIDATE = codeNode('Validate Required Fields', 'validate-booking.js', [1800, Y]);
const DUP = codeNode('Check Duplicate Booking', 'duplicate-check.js', [2020, Y]);
const TZ = codeNode('Normalize Timezone', 'normalize-timezone.js', [2240, Y]);
const DEMO_AV = ifNode('Demo Mode? (Availability)', [2460, Y], [cond('demo-av', '={{ $json.config.demo_mode }}', OP.isTrue)]);
const LOAD_CAL = codeNode('DEMO · Load Calendar Availability', 'load-demo-calendar.js', [2700, 240]);
const GCAL_CHECK = node('Calendar · Check Availability (Google)', 'n8n-nodes-base.googleCalendar', 1.3, [2700, P], {
  resource: 'calendar',
  operation: 'availability',
  calendar: { __rl: true, mode: 'id', value: '={{ $json.config.calendar_id }}' },
  timeMin: '={{ $json.search_window_start_utc }}',
  timeMax: '={{ $json.search_window_end_utc }}',
  options: { outputFormat: 'raw' },
}, { disabled: true, onError: 'continueRegularOutput', notes: 'Disabled · Google free/busy', notesInFlow: true });
const GCAL_MAP = codeNode('Calendar · Map Free/Busy', 'calendar-map-freebusy.js', [2920, P]);
const CONFLICT = codeNode('Detect Conflict', 'detect-conflict.js', [3100, Y]);

// ---------------------------------------------------------------- 3 · slots & decision
const FIND = codeNode('Find Candidate Slots', 'find-candidate-slots.js', [3340, Y]);
const RANK = codeNode('Rank Candidate Slots', 'rank-slots.js', [3560, Y]);
const DECIDE = codeNode('Booking Decision', 'booking-decision.js', [3780, Y]);
const LANES = ['READY_TO_CONFIRM', 'PROPOSE_ALTERNATIVE', 'NO_AVAILABILITY', 'DUPLICATE', 'NEEDS_REVIEW', 'INVALID', 'CANCELLED'];
const ROUTER = node('Booking Status Router', 'n8n-nodes-base.switch', 3.2, [4000, Y], {
  rules: {
    values: LANES.map((s) => ({
      conditions: conditions([cond(`lane-${s}`, '={{ $json.booking_status }}', OP.equals, s)]),
      renameOutput: true,
      outputKey: s,
    })),
  },
  options: { fallbackOutput: 'extra', renameFallbackOutput: 'UNROUTED' },
});
const MERGE_LANES = node('Merge · Status Lanes', 'n8n-nodes-base.merge', 3.2, [4300, Y], { numberInputs: LANES.length + 1 });

// ---------------------------------------------------------------- 4 · drafts & record
const NEEDS_DRAFT = ifNode('Needs Confirmation Draft?', [4540, Y], [cond('needs-draft', '={{ $json.requires_draft }}', OP.isTrue)]);
const DEMO_DRAFT = ifNode('Demo Mode? (Draft)', [4760, 260], [cond('demo-draft', '={{ $json.config.demo_mode }}', OP.isTrue)]);
const MOCK = codeNode('DEMO · Mock Confirmation Draft', 'mock-confirmation.js', [5000, 160]);
const AI_BUILD = codeNode('AI · Build Draft Request', 'ai-build-draft-request.js', [5000, P]);
const AI_DRAFT = aiHttp('AI · Draft Booking Message', [5220, P], 'Disabled · provider-agnostic · key via n8n credential');
const AI_APPLY = codeNode('AI · Apply Draft (guardrails)', 'ai-apply-draft.js', [5440, P]);
const MERGE_DRAFT = node('Merge · Draft Paths', 'n8n-nodes-base.merge', 3.2, [5460, Y], { numberInputs: 3 });
const OWNER = codeNode('Assign Booking Owner / Team', 'assign-owner.js', [5680, Y]);
const FINAL = codeNode('Build Final Booking Record', 'build-final-record.js', [5900, Y]);
const SUMMARY = codeNode('Summary · Run Report', 'demo-summary.js', [6160, 200]);
const RESPOND = node('Respond to Webhook', 'n8n-nodes-base.respondToWebhook', 1.4, [6160, 400], { respondWith: 'allIncomingItems', options: {} });

// ---------------------------------------------------------------- 5 · production outputs (disabled)
const DT = node('Log · Data Table', 'n8n-nodes-base.dataTable', 1.1, [6160, 700], {
  resource: 'row',
  operation: 'insert',
  dataTableId: { __rl: true, mode: 'id', value: 'REPLACE_WITH_DATA_TABLE_ID' },
  columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  options: {},
}, { disabled: true });
const SHEETS = node('Log · Google Sheets', 'n8n-nodes-base.googleSheets', 4.7, [6160, 860], {
  operation: 'append',
  documentId: { __rl: true, mode: 'id', value: 'REPLACE_WITH_SPREADSHEET_ID' },
  sheetName: { __rl: true, mode: 'name', value: 'Bookings' },
  columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  options: {},
}, { disabled: true });
const CRM = node('CRM · Upsert Booking (Generic API)', 'n8n-nodes-base.httpRequest', 4.2, [6160, 1020], {
  method: 'POST',
  url: "={{ $('Config').first().json.config.crm_endpoint }}",
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify({ external_id: $json.booking_id, email: $json.email, name: $json.full_name, company: $json.company, status: $json.booking_status, priority: $json.booking_priority, owner: $json.owner_team, selected_slot_utc: $json.selected_slot_utc }) }}',
  options: { timeout: 30000 },
}, { disabled: true, onError: 'continueRegularOutput' });
const gateRule = (key, list) => ({ conditions: conditions(list), renameOutput: true, outputKey: key });
const prodGuards = (id, flag) => [
  cond(`${id}-prod`, '={{ $json.demo_mode }}', OP.isFalse),
  cond(`${id}-flag`, `={{ $json.${flag} }}`, OP.isTrue),
  cond(`${id}-approved`, '={{ $json.human_approved }}', OP.isTrue),
];
const GATE = node('Calendar Write Gate', 'n8n-nodes-base.switch', 3.2, [6420, 860], {
  rules: {
    values: [
      gateRule('CREATE_EVENT', [cond('g-create', '={{ $json.booking_status }}', OP.equals, 'READY_TO_CONFIRM'), cond('g-create-new', '={{ $json.calendar_event_id }}', OP.empty), ...prodGuards('g-create', 'calendar_writes_enabled')]),
      gateRule('RESCHEDULE_EVENT', [cond('g-resched', '={{ $json.booking_status }}', OP.equals, 'READY_TO_CONFIRM'), cond('g-resched-existing', '={{ $json.calendar_event_id }}', OP.notEmpty), ...prodGuards('g-resched', 'calendar_writes_enabled')]),
      gateRule('CANCEL_EVENT', [cond('g-cancel', '={{ $json.booking_status }}', OP.equals, 'CANCELLED'), cond('g-cancel-id', '={{ $json.calendar_event_id }}', OP.notEmpty), ...prodGuards('g-cancel', 'calendar_writes_enabled')]),
      gateRule('SEND_SCHEDULING_LINK', [cond('g-link', '={{ $json.booking_status }}', OP.regex, '^(PROPOSE_ALTERNATIVE|NO_AVAILABILITY)$'), ...prodGuards('g-link', 'scheduling_links_enabled')]),
    ],
  },
  options: {},
}, { notes: 'Demo: 0 items pass', notesInFlow: true });
const GCAL_CREATE = node('Calendar · Create Event (Google)', 'n8n-nodes-base.googleCalendar', 1.3, [6680, 680], {
  calendar: { __rl: true, mode: 'id', value: '={{ $json.calendar_id }}' },
  start: '={{ $json.selected_slot_start_utc }}',
  end: '={{ $json.selected_slot_end_utc }}',
  useDefaultReminders: true,
  additionalFields: {
    summary: '={{ $json.meeting_type }} · {{ $json.company || $json.full_name }}',
    description: '=Booking {{ $json.booking_id }} · {{ $json.meeting_topic }}\nOwner: {{ $json.owner_team }}',
    attendees: ['={{ $json.email }}'],
    sendUpdates: 'none',
  },
}, { disabled: true });
const GCAL_UPDATE = node('Calendar · Update Event (Google)', 'n8n-nodes-base.googleCalendar', 1.3, [6680, 840], {
  calendar: { __rl: true, mode: 'id', value: '={{ $json.calendar_id }}' },
  operation: 'update',
  eventId: '={{ $json.calendar_event_id }}',
  useDefaultReminders: true,
  updateFields: { start: '={{ $json.selected_slot_start_utc }}', end: '={{ $json.selected_slot_end_utc }}', sendUpdates: 'none' },
}, { disabled: true });
const GCAL_CANCEL = node('Calendar · Cancel Event (Google)', 'n8n-nodes-base.googleCalendar', 1.3, [6680, 1000], {
  calendar: { __rl: true, mode: 'id', value: '={{ $json.calendar_id }}' },
  operation: 'delete',
  eventId: '={{ $json.calendar_event_id }}',
  options: { sendUpdates: 'none' },
}, { disabled: true });
const CALENDLY = node('Scheduling · Calendly / Generic API', 'n8n-nodes-base.httpRequest', 4.2, [6680, 1160], {
  method: 'POST',
  url: 'https://api.calendly.com/scheduling_links',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: "={{ JSON.stringify({ max_event_count: 1, owner: $('Config').first().json.config.calendly_event_type_uri, owner_type: 'EventType' }) }}",
  options: { timeout: 30000 },
}, { disabled: true, onError: 'continueRegularOutput', notes: 'Single-use booking link instead of manual options', notesInFlow: true });
const EVENT_ID = node('Calendar · Return Event ID', 'n8n-nodes-base.set', 3.4, [6920, 760], {
  assignments: {
    assignments: [
      { id: uuid('ev:booking'), name: 'booking_id', value: "={{ $('Build Final Booking Record').item.json.booking_id }}", type: 'string' },
      { id: uuid('ev:id'), name: 'calendar_event_id', value: '={{ $json.id }}', type: 'string' },
      { id: uuid('ev:link'), name: 'calendar_event_link', value: '={{ $json.htmlLink }}', type: 'string' },
      { id: uuid('ev:status'), name: 'calendar_status', value: '={{ $json.status }}', type: 'string' },
    ],
  },
  options: {},
});

// ---------------------------------------------------------------- connections
const connections = {};
const link = (from, to, fromOutput = 0, toInput = 0) => {
  connections[from] = connections[from] || { main: [] };
  const outs = connections[from].main;
  while (outs.length <= fromOutput) outs.push([]);
  outs[fromOutput].push({ node: to, type: 'main', index: toInput });
};
link(RUN, LOAD); link(LOAD, NORM); link(HOOK, NORM);
link(NORM, CONFIG); link(CONFIG, NEEDS_INTERP);
link(NEEDS_INTERP, AI_INTERP_BUILD, 0); link(NEEDS_INTERP, MERGE_INTERP, 1, 0);
link(AI_INTERP_BUILD, AI_INTERP); link(AI_INTERP, AI_INTERP_APPLY); link(AI_INTERP_APPLY, MERGE_INTERP, 0, 1);
link(MERGE_INTERP, VALIDATE); link(VALIDATE, DUP); link(DUP, TZ); link(TZ, DEMO_AV);
link(DEMO_AV, LOAD_CAL, 0); link(DEMO_AV, GCAL_CHECK, 1);
link(GCAL_CHECK, GCAL_MAP); link(LOAD_CAL, CONFLICT); link(GCAL_MAP, CONFLICT);
link(CONFLICT, FIND); link(FIND, RANK); link(RANK, DECIDE); link(DECIDE, ROUTER);
LANES.forEach((_, n) => link(ROUTER, MERGE_LANES, n, n));
link(ROUTER, MERGE_LANES, LANES.length, LANES.length);
link(MERGE_LANES, NEEDS_DRAFT);
link(NEEDS_DRAFT, DEMO_DRAFT, 0); link(NEEDS_DRAFT, MERGE_DRAFT, 1, 2);
link(DEMO_DRAFT, MOCK, 0); link(DEMO_DRAFT, AI_BUILD, 1);
link(MOCK, MERGE_DRAFT, 0, 0);
link(AI_BUILD, AI_DRAFT); link(AI_DRAFT, AI_APPLY); link(AI_APPLY, MERGE_DRAFT, 0, 1);
link(MERGE_DRAFT, OWNER); link(OWNER, FINAL);
for (const t of [SUMMARY, RESPOND, DT, SHEETS, CRM, GATE]) link(FINAL, t);
link(GATE, GCAL_CREATE, 0); link(GATE, GCAL_UPDATE, 1); link(GATE, GCAL_CANCEL, 2); link(GATE, CALENDLY, 3);
link(GCAL_CREATE, EVENT_ID); link(GCAL_UPDATE, EVENT_ID);

// ---------------------------------------------------------------- workflow + self-checks
const workflow = {
  name: 'AI Appointment & Booking Automation',
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', timezone: 'Europe/Berlin' },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const names = new Set(nodes.map((n) => n.name));
if (names.size !== nodes.length) throw new Error('Duplicate node names');
for (const [from, c] of Object.entries(connections)) {
  if (!names.has(from)) throw new Error(`Connection from unknown node ${from}`);
  for (const out of c.main) for (const t of out) if (!names.has(t.node)) throw new Error(`Connection to unknown node ${t.node}`);
}
const json = JSON.stringify(workflow, null, 2);
if (nodes.some((n) => n.credentials)) throw new Error('Credentials must not be stored in the workflow JSON');
if (/sk-ant-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|Bearer [A-Za-z0-9._-]{20,}/.test(json)) throw new Error('Secret-like string found in workflow JSON');

const outPath = path.join(ROOT, 'workflows', 'ai-booking-automation.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, json + '\n');
const functional = nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
console.log(`Built ${path.relative(ROOT, outPath)}: ${functional.length} nodes (+${nodes.length - functional.length} sticky notes), ${functional.filter((n) => n.disabled).length} disabled production nodes, ${(json.length / 1024).toFixed(0)} KB`);
