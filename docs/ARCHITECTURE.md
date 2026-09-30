# Architecture

One n8n workflow with 43 functional nodes in five colour-coded sections. Every request travels through the same
linear pipeline as one item. Instead of branching early, each step adds its own fields (`validation`,
`duplicate`, `timezone_normalization`, `availability`, …) and **Booking Decision** makes the final call in
one place. Branches exist only where the demo and production paths differ or where drafts are prepared. Each
branch is closed by a **Merge** node, so downstream nodes run exactly once per execution. This matters for the
batch-level duplicate check and the slot holds.

## Section 1 · Booking intake & demo (blue)

| Node | Type | Purpose |
|---|---|---|
| Run Demo | Manual Trigger | Starts the offline demo |
| DEMO · Load Booking Requests | Code | Emits the 10 fictional requests (embedded from `test-data/sample-bookings.json`) |
| Webhook · Receive Booking Request | Webhook | Production intake, `POST /booking-request`, answered by *Respond to Webhook* |
| Normalize Booking Request | Code | Unwraps webhook bodies; trims and cleans text; lowercases email; maps type and urgency aliases; parses `1:15 PM`, `2pm`, `2026/10/20`, `"45 min"`; generates an ID if missing; keeps `raw_request` |
| Config | Set | Every business rule and integration setting (`config.*`). `demo_mode = true` by default |
| Needs AI Interpretation? | If | Only true in production when structured fields are missing but a message exists |
| AI · Build Interpretation Request → AI · Interpret Free-Text Request → AI · Apply Interpretation (guarded) | Code → HTTP *(disabled)* → Code | Optional extraction of explicitly stated fields; fills empty fields only |
| Merge · Interpretation Paths | Merge (append) | Rejoins both paths |

## Section 2 · Validation, timezone & availability (green)

| Node | Purpose |
|---|---|
| Validate Required Fields | Required fields per action (book or cancel); email, duration range, meeting type, IANA time zone, ISO date and time; injection scan across free-text fields |
| Check Duplicate Booking | Key `email + meeting_type + preferred_date`, with start time within ±60 min. The earliest submission wins. Compares against the batch and the booking ledger (demo: embedded; production: connect a lookup). Also resolves cancellation targets |
| Normalize Timezone | Requester wall-clock → UTC (DST-safe, rejects non-existent times); keeps requester and office views; flexible window; free/busy search window |
| Demo Mode? (Availability) | Chooses the demo calendar or Google free/busy |
| DEMO · Load Calendar Availability | Converts the fictional calendar's local events to UTC and attaches `availability` |
| Calendar · Check Availability (Google) → Calendar · Map Free/Busy | *(disabled)* free/busy query → same `availability` shape. With the node disabled, availability becomes `not_connected` |
| Detect Conflict | Checks the exact requested slot: notice, coverage, business day and hours, lunch, events with buffer |

### Availability contract

Both availability sources produce the same object, so the downstream logic never knows which one was used:

```json
{
  "status": "ok | not_connected | error",
  "source": "demo-calendar.json (fictional, offline) | google_calendar_freebusy",
  "business_timezone": "Europe/Berlin",
  "business_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "business_hours": { "start": "09:00", "end": "17:00" },
  "recurring_blocks": [{ "label": "Lunch break (blocked)", "days": ["Mon", "..."], "start": "12:00", "end": "13:00" }],
  "coverage": { "from": "2026-10-12", "to": "2026-10-23" },
  "busy": [{ "id": "EVT-1203", "title": "Solution workshop: Aster Labs", "kind": "client", "start_utc": "…", "end_utc": "…" }]
}
```

## Section 3 · Conflict resolution & slot selection (purple)

| Node | Purpose |
|---|---|
| Find Candidate Slots | Deterministic priority (HIGH / NORMAL / LOW from structured fields); generates every feasible slot on a 15-minute grid within the horizon; skips times outside the requester's 08:00–19:00; measures calendar-only capacity on the requested days |
| Rank Candidate Slots | HIGH: earliest first. Others: window → same day → alternative dates → fewest days → closest time of day. Adds a human-readable `rank_reason` |
| Booking Decision | Status rules (see README). **Pass 1** holds requested slots in priority order. **Pass 2** builds diverse top-3 proposals from what is still free and soft-holds them. Writes `decision_trace` |
| Booking Status Router | Switch with one lane per status (plus `UNROUTED` fallback) so counts per outcome are visible on the canvas |
| Merge · Status Lanes | Rejoins the lanes so drafting runs once |

## Section 4 · Confirmation draft & booking record (orange)

| Node | Purpose |
|---|---|
| Needs Confirmation Draft? | `requires_draft` is true for confirm, propose, next-best, incomplete (with a usable email) and cancellation |
| Demo Mode? (Draft) | Mock drafts in demo; AI drafts in production |
| DEMO · Mock Confirmation Draft | Deterministic, professional templates; placeholders only (`{{MEETING_LINK}}`, `{{OFFICE_ADDRESS}}`, `{{SENDER_NAME}}`, `{{COMPANY_NAME}}`) |
| AI · Build Draft Request → AI · Draft Booking Message → AI · Apply Draft (guardrails) | Provider-agnostic request with JSON-schema output, *(disabled)* HTTP call, then guardrails with template fallback |
| Merge · Draft Paths | Rejoins mock, AI and no-draft paths |
| Assign Booking Owner / Team | Role-based queues by status and meeting type; SLA by priority (60 / 240 / 1440 min) |
| Build Final Booking Record | Clean flat record per request, sorted by booking ID; working data removed |
| Summary · Run Report | One item: counts per status, overview lines, safety counters |
| Respond to Webhook | Returns the records to the webhook caller (no-op in manual runs) |

## Section 5 · Production integrations (red, disabled)

| Node | Notes |
|---|---|
| Log · Data Table | Insert each record (auto-map). Set the table ID |
| Log · Google Sheets | Append each record to the `Bookings` sheet. Set the spreadsheet ID |
| CRM · Upsert Booking (Generic API) | POST to `config.crm_endpoint` with a minimal payload |
| Calendar Write Gate | **Enabled** Switch. Items pass only when `demo_mode = false` AND the write flag is true AND `human_approved = true`. Outputs: CREATE_EVENT, RESCHEDULE_EVENT, CANCEL_EVENT, SEND_SCHEDULING_LINK |
| Calendar · Create / Update / Cancel Event (Google) | `sendUpdates: none`, so the workflow never emails attendees |
| Calendar · Return Event ID | Pairs the created event ID and link back to the booking ID |
| Scheduling · Calendly / Generic API | Creates a single-use scheduling link instead of manual options |

## Execution-order notes (n8n v1 order)

- Disabled nodes pass items through unchanged. The production map and guardrail nodes detect a pass-through
  item (it still has `booking_id` and `config`) and fall back safely.
- An If or Switch output with zero items does not trigger its downstream nodes. Merge (append) nodes run once,
  with whatever arrived. This was verified in n8n 2.37.10 by the e2e test ("ran exactly once" assertions).
- Code nodes run in "Run Once for All Items" mode. The batch-level logic (duplicates, holds) relies on
  seeing all items together.

## Failure modes

| Situation | Result |
|---|---|
| Missing time zone, duration, email… | `NEEDS_REVIEW / INCOMPLETE` with the missing fields listed, plus an info-request draft |
| Malformed values | `INVALID` with field, reason and value listed |
| DST-gap local time | `INVALID` (non-existent local time), never shifted |
| Calendar node disabled or erroring | `NEEDS_REVIEW / AVAILABILITY_UNKNOWN`, never confirmed |
| AI disabled, refusal, truncation, bad JSON, guardrail hit | Deterministic template draft; `draft_source` explains why |
| Injection-style text | `NEEDS_REVIEW / SECURITY_FLAG`, no hold, no draft, priority capped |
| Two requests for the same free slot | First by priority, then by submission time, gets it; the other gets alternatives |
| Duplicate submission | `DUPLICATE`, linked to the original, no hold, no draft |

## Source layout and build

`scripts/build-workflow.js` assembles the workflow:

- Each Code node's `jsCode` comes from `code/*.js`.
- Shared helpers (`code/_shared/*.js`) are inlined where a file contains `// @include …`.
- Demo data and prompts are embedded where a file contains `/*@@PLACEHOLDER@@*/`.

The build checks that every connection target exists and that no credentials or secret-like strings are
present. Node IDs are derived from node names, so rebuilds produce stable diffs.
