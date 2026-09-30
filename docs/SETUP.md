# Setup

## Requirements

- n8n **2.37.10** (tested). Any recent 2.x release with Code, If, Switch, Merge v3.2, Set v3.4 and Data Table nodes should work.
- For the build and test scripts: Node.js 18+ **or** Docker. The scripts need no npm dependencies.

## 1 · Import the workflow

1. Open n8n, for example `http://localhost:6083`.
2. Go to **Overview → Create workflow**, open the **⋯** menu (top right), then **Import from File…**.
   Alternatively, drag the file onto an empty canvas.
3. Choose `workflows/ai-booking-automation.json`.
4. Click **Save**. The workflow stays **inactive**. It does not need to be active for the demo.

Importing only creates the workflow. It creates no credentials, events or messages.

## 2 · Run the demo

1. Next to **Execute workflow** (bottom of the canvas), choose the trigger **Run Demo**.
   The workflow has two triggers: *Run Demo* and *Webhook · Receive Booking Request*.
2. Click **Execute workflow**. The run takes a few seconds and makes no external calls.
3. Inspect:
   - **Summary · Run Report**: one item with counts per status and a one-line overview of each request.
   - **Build Final Booking Record**: 10 structured booking records. Use the *Table* or *JSON* view.
   - **Booking Status Router**: item counts on each lane.
   - **DEMO · Mock Confirmation Draft**: the draft subjects and bodies.

`config.demo_mode` is `true` by default (in the **Config** node). Demo results are deterministic because the
clock is frozen at `config.demo_reference_date = 2026-10-09`, 17:00 Europe/Berlin.

## 3 · Build and test from source (optional)

With Node.js on the host:

```bash
node scripts/build-workflow.js
```

```bash
node scripts/test-offline.js
```

Without Node.js, run the same scripts inside the n8n image, offline (Git Bash on Windows shown):

```bash
MSYS_NO_PATHCONV=1 docker run --rm --network none -v "$(pwd -W):/work" -w /work --entrypoint sh n8n-ffmpeg:2.37.10 -c "node scripts/build-workflow.js && node scripts/test-offline.js"
```

On macOS/Linux, use `$(pwd)` instead of `$(pwd -W)`.

To run the full end-to-end test against real n8n in a throwaway container (`--network none`, removed afterwards):

```bash
sh scripts/e2e/run-e2e.sh
```

Set `N8N_IMAGE` to use a different image, for example `N8N_IMAGE=n8nio/n8n:2.37.10`. The test never touches a
running n8n instance, container or volume. Outputs are written to `scripts/e2e/output/` (git-ignored).

## 4 · Switch to production (when ready)

Work through these in order. Each step can be tested on its own.

| Step | Node(s) | What to do |
|---|---|---|
| 1 | **Config** | Set `business_timezone`, business hours, lunch, `calendar_id`, `ai_provider` / `ai_endpoint` / `ai_model`. |
| 2 | **Calendar · Check Availability (Google)** | Create a *Google Calendar OAuth2* credential, select it, then **enable** the node. |
| 3 | **AI · Draft Booking Message** | Create a *Header Auth* credential (Anthropic: name `x-api-key`; OpenAI-compatible: name `Authorization`, value `Bearer …`). Select it, then enable the node. |
| 4 | **AI · Interpret Free-Text Request** *(optional)* | Same credential. Enable only if you receive free-text requests. |
| 5 | **Log · Data Table** / **Log · Google Sheets** | Create the table or sheet, set its ID, then enable. |
| 6 | **CRM · Upsert Booking (Generic API)** | Set `config.crm_endpoint`, add a credential, adjust the body to your CRM, then enable. |
| 7 | **Config** | Set `demo_mode = false`. |
| 8 | **Webhook · Receive Booking Request** | Activate the workflow. POST JSON to `/webhook/booking-request`. |
| 9 | **Calendar · Create/Update/Cancel Event**, **Scheduling · Calendly** | Only after a human-approval step sets `human_approved = true`. Set `calendar_writes_enabled` / `scheduling_links_enabled` in Config, then enable the nodes. |

Notes:

- With `demo_mode = false` and the calendar node still disabled, every schedulable request becomes
  `NEEDS_REVIEW / AVAILABILITY_UNKNOWN`. This is intentional fail-safe behaviour.
- The AI provider is switched in Config: `ai_provider = anthropic | openai`, plus the matching `ai_endpoint`
  and `ai_model`. No API key belongs in Config or in the workflow JSON.
-  Set `ai_model` to the model ID supported by your configured AI provider. Drafting is a short, bounded task..

## Example webhook call (production)

```bash
curl -X POST http://localhost:6083/webhook/booking-request -H "Content-Type: application/json" -d '{"full_name":"Test Person","email":"test.person@example.com","meeting_type":"consultation","requested_duration_minutes":30,"timezone":"Europe/London","preferred_date":"2026-11-10","preferred_start_time":"10:00","source":"website_form"}'
```

The response is the final booking record, returned by **Respond to Webhook**. Nothing is sent to the requester.

## Environment variables

See `.env.example`. API keys are **not** environment variables in this project. They are stored as n8n
credentials.
