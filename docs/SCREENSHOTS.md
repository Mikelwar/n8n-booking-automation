# Screenshot guide

Take all screenshots after one run of **Run Demo** in demo mode. Recommended setup:

- Browser window about 1920×1080, n8n light theme, zoom so text on the sticky notes is readable.
- Close the left sidebar. Hide personal instance details such as the URL bar, account name and other workflows.
- Add the disclosure line in the image caption or the portfolio text:
  *"Demo execution using fictional calendar availability and mock AI responses. Production paths are ready for calendar, AI, CRM and scheduling integrations."*

## 1 · Full workflow overview ⭐ recommended Contra cover

**What:** The whole canvas after a successful run, showing all five coloured sections, the header note, and
green execution checks and item counts on the connections.

**How:** Run the demo, then press **1** or click the "Zoom to fit" button. Zoom in one step if
the section titles are too small. Crop to the sections and the header.

**Why it's the cover:** it explains the whole system at a glance: intake → validation → slot selection →
drafts → production integrations. The item counts show that it really ran.

If one image looks too dense for the Contra thumbnail, make a second, tighter cover crop of sections 2–4
(validation → slot selection → router).

## 2 · Successful demo execution

**What:** **Summary · Run Report** output panel in JSON view. It shows `requests_processed: 10`, `by_status`,
the overview lines, `messages_sent: 0` and `calendar_write_eligible: 0`.

**How:** Double-click *Summary · Run Report*, open the **JSON** tab, and collapse nothing.

## 3 · Conflict / alternative-slot routing

**What:** The **Booking Status Router** area of the canvas with item counts on each lane:

| Lane | Items |
|---|---|
| READY_TO_CONFIRM | 2 |
| PROPOSE_ALTERNATIVE | 2 |
| NO_AVAILABILITY | 1 |
| DUPLICATE | 1 |
| NEEDS_REVIEW | 2 |
| INVALID | 1 |
| CANCELLED | 1 |

As a second image, open **Build Final Booking Record** on **BK-1003**. Show `conflict_detected: true`,
`conflict_reason`, `conflicting_event` and the three `candidate_slots` with their reasons.

## 4 · Final structured booking record

**What:** **Build Final Booking Record** in **Table** view. Include the columns `booking_id`, `status_label`,
`booking_priority`, `selected_slot_local`, `owner_team`, `status`. Take a JSON-view close-up of one full
record (BK-1002 works well: HIGH priority, reasons, SLA).

## 5 · Confirmation / rescheduling draft

**What:** **DEMO · Mock Confirmation Draft** output for **BK-1002** (priority rescheduling options) or
**BK-1004** (fully booked day → next-best options). Show `confirmation_subject`, `confirmation_body` and
`draft_status: DRAFT_ONLY · NOT SENT · human approval required`.

Tip: the Schema or Table view renders the multi-line body more readably than raw JSON.

## 6 · Timezone-aware booking example

**What:** Record **BK-1007** (New York requester). Show:

- `requester_timezone: America/New_York`
- `requested_time_local: Tue 13 Oct 2026, 10:15–10:45 EDT`
- `requested_time_utc: 2026-10-13T14:15:00Z → …`
- `requested_time_business: … 16:15–16:45 GMT+2 (Europe/Berlin)`
- `booking_status: READY_TO_CONFIRM`

Optionally, add the draft for BK-1007, which shows both the requester's local time and the office time.

## Optional extras

- **Security:** BK-1008 record with `security_flags` (prompt-injection signals) and `NEEDS_REVIEW / SECURITY_FLAG`.
- **Safety gate:** **Calendar Write Gate** showing 0 items on every output, next to the disabled Google Calendar nodes.
- **Config:** the **Config** node showing `demo_mode = true` and the business rules.

## Do not

- Do not present mock drafts or the fictional calendar as live production results.
- Do not show any credential screens, API keys or real calendar IDs.
