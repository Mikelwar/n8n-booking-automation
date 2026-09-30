# Portfolio copy

All copy below describes a **demo**. Keep the disclosure line wherever results or screenshots are shown:

> Demo execution using fictional calendar availability and mock AI responses. Production paths are ready for calendar, AI, CRM and scheduling integrations.

---

## 1 · Contra: Work title

**AI Appointment & Booking Automation in n8n: conflict-checked, timezone-aware scheduling**

## 2 · Contra: Work description

An n8n workflow that takes incoming meeting requests and turns each one into a structured booking record with a clear status.

Each request is validated, checked for duplicates and converted from the requester's time zone to UTC. It is then checked against calendar availability (business hours, lunch block, existing meetings and buffers) and given one outcome: ready to confirm, propose alternatives, no availability, duplicate, needs review, invalid or cancelled.

When the requested time is taken, the workflow ranks three alternative slots. Urgent executive or escalation requests get the earliest feasible options. Slot holds stop two requests in the same run from being offered the same time.

The workflow drafts the confirmation, rescheduling or missing-information message and assigns an owner with a response SLA. Nothing is sent or booked automatically.

Scheduling decisions are rule-based. AI is used only for wording, behind guardrails, with a template fallback. Free text from requesters is treated as untrusted and scanned for prompt-injection attempts.

Built and tested on n8n 2.37.10, including an automated end-to-end test in an isolated, offline n8n container.

*Demo execution using fictional calendar availability and mock AI responses. Production paths are ready for calendar, AI, CRM and scheduling integrations.*

**Tools:** n8n · JavaScript · Google Calendar API · Anthropic / OpenAI-compatible API · Calendly API · Google Sheets · Docker

## 3 · Upwork: Portfolio title

**n8n Booking Automation: Validation, Timezones, Conflict Detection & AI Drafts (Demo)**

## 4 · Upwork: Portfolio description

**Challenge:** Booking requests arrive incomplete, duplicated, in different time zones and often for times that are already taken. Handling them by hand leads to double bookings, timezone mistakes and slow replies to important clients.

**Solution:** I built an n8n workflow that processes every request through the same deterministic pipeline:

- validation
- duplicate detection
- UTC time normalization
- availability and conflict checks
- ranked alternative slots
- a single booking status per request

It prepares a professional confirmation or rescheduling draft for a person to review and send, assigns an owner and an SLA, and outputs a clean record for a calendar or CRM.

**Safety by design:**

- AI writes wording only; it never decides availability or status.
- Requester text is treated as untrusted and scanned for prompt injection.
- Calendar writes require explicit human approval.
- The workflow never sends messages on its own.

**Result (demo):** 10 fictional scenarios processed end-to-end:

- normal booking
- VIP escalation
- conflict
- fully booked day
- incomplete request
- duplicate
- cross-timezone booking
- prompt-injection attempt
- invalid data
- cancellation

Verified by automated tests against a real, network-isolated n8n instance.

*Demo execution using fictional calendar availability and mock AI responses. Production paths are ready for calendar, AI, CRM and scheduling integrations.*

## 5 · LinkedIn: Project description

I built an appointment and booking automation in n8n that handles the untidy parts of scheduling:

- incomplete forms
- duplicate submissions
- requests in other time zones
- requests for times that are already taken

Every request gets the same checks: validation, duplicate detection, conversion to UTC (the requester's local time is kept), availability and conflict checks, and ranked alternatives when the preferred slot is busy.

Each request then gets one clear status, a draft reply for a person to review, and an owner with a response SLA.

Two design choices mattered most:

1. Scheduling decisions are deterministic rules; AI only helps with wording, behind guardrails.
2. Nothing is sent or booked without a human.

The demo runs fully offline on fictional data, and the production integrations (Google Calendar, AI provider, CRM, Calendly, Sheets) are in place and ready to connect.

*Demo execution using fictional calendar availability and mock AI responses.*

## 6 · GitHub: Short description

n8n workflow for booking requests: validation, duplicate detection, timezone normalization, conflict checks, ranked alternative slots and AI-assisted confirmation drafts. Offline demo plus a production-ready integration path.

## 7 · One-sentence elevator pitch

An n8n workflow that turns messy meeting requests into conflict-checked, timezone-correct booking records with a clear status and a ready-to-send draft reply, without ever double-booking or sending anything on its own.

## 8 · Business value (3 bullets)

- **No double bookings or timezone mistakes:** every slot is checked in UTC against business hours, existing meetings and other requests in the same batch before it is offered.
- **Faster, consistent replies:** each request gets a status, ranked alternatives, a draft message, an owner and an SLA, with urgent clients prioritised.
- **Safe to adopt:** deterministic decisions, human approval before any calendar write or email, untrusted-input screening, and a fail-safe path when a system is unavailable.
