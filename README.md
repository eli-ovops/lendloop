# LendLoop — neighbourhood tool-lending board

LendLoop lets neighbours lend and borrow tools: browse a public board, list a
tool, request it for a date range, approve/decline, and confirm the return.
Automation (owner notifications and daily overdue reminders) runs in **n8n**
over HMAC-signed webhooks. Convex records a delivery claim before each send
attempt and the SMTP acceptance afterwards.

**Stack:** Next.js (App Router) + TypeScript · Clerk (authentication) ·
Convex (database + backend functions + HTTP endpoints) · n8n (self-hosted
automation)

## Verify the core logic

Use Node 22 and run `npm ci`, `npm test`, and `npm run lint`. The tests
exercise the Convex handlers with synthetic data, plus the structure of the
exported n8n workflows. They cover the active-loan guard, return of older
records, public owner labels and signed email claims. The connected services
and live email delivery can be checked separately with the setup below.

---

## What it does

| Capability | Where |
| --- | --- |
| Public, read-only tool board (no sign-in needed) | `convex/tools.ts` → `list`, `app/page.tsx` |
| Sign-in / sign-up | Clerk (`proxy.ts`, `components/Header.tsx`) |
| List a tool, pause/remove it | `convex/tools.ts` → `create` / `setAvailability` / `remove` |
| Request a borrow for a date range | `convex/borrowRequests.ts` → `request` |
| Approve / decline / cancel / mark returned | `convex/borrowRequests.ts` |
| Admin oversight (all users, all requests) | `convex/users.ts` → `listAll`, `convex/borrowRequests.ts` → `listAll`, `app/admin/page.tsx` |
| Email the owner when a request arrives | n8n workflow 01 |
| Daily overdue-loan reminders | n8n workflow 02 |
| Automation failure logging | n8n workflow 03 (error workflow) |

## Architecture

```
┌────────────┐   Clerk JWT    ┌──────────────────────────────┐
│  Next.js   │ ─────────────▶ │  Convex                      │
│  (App      │   queries /    │  functions = the ONLY place  │
│   Router)  │   mutations    │  authorisation is enforced   │
└────────────┘                │                              │
                              │  borrowRequests.request      │
                              │    └─ scheduler ─▶ internal  │
                              │       action: sign + POST ───┼──▶ n8n workflow 01
                              └──────────────────────────────┘    (verify HMAC,
        ▲ signed HTTP callbacks        │                          claim and
        │ (.convex.site)               │                          send email)
        │                              │
        └──────────────────────────────┴── n8n workflow 02 (daily cron:
                                             signed fetch of overdue loans,
                                             reminder emails, write-backs)
                              n8n workflow 03 = error workflow for 01 + 02
```

**Design rule that matters:** the UI hides buttons it thinks you shouldn't
see, but that is cosmetic. Every rule below is re-checked inside the Convex
function that performs the action, so calling the API directly with a
hand-crafted request gets the same answer as clicking around the UI.

## Permission model

Two roles: **`user`** and **`admin`** (stored on the Convex `users` record,
never trusted from the client).

| Action | Who | Enforced in |
| --- | --- | --- |
| Browse the board | anyone, signed out OK | `tools.list` is a public query |
| List a tool | any signed-in user | `tools.create` → `requireUser` |
| Request a borrow | signed-in user, **not** the tool's owner, tool must be available, no overlapping pending/approved request of mine | `borrowRequests.request` |
| Approve / decline | tool owner **or admin**; approval requires an available tool with no active loan | `borrowRequests.approve/decline` → `canManage` |
| Cancel | the borrower (or admin), pending only | `borrowRequests.cancel` |
| Mark returned | tool owner **or admin** (a borrower cannot close their own loan) | `borrowRequests.markReturned` |
| Pause / remove a tool | owner or admin; an active loan blocks relisting and removal | `tools.setAvailability` / `tools.remove` |
| View all users / all requests | admin only | `requireAdmin` in both `listAll` queries |
| Change a role | **nobody via the API** — internal mutation only (Convex dashboard / CLI) | `users.setRole` is an `internalMutation` |

Role bootstrapping: a new user becomes admin if their email is listed in the
Convex deployment env var `ADMIN_EMAILS` (comma-separated) at first sign-in;
otherwise they are a `user`. After that, use
`npx convex run users:setRole '{"userId": "...", "role": "admin"}'`.

## Automation (n8n)

Workflow exports live in [`n8n/`](./n8n) and import as-is
(Workflows → Import from File). All three are covered by the same security
pattern:

- **HMAC-SHA256 on every hop.** Convex signs outbound webhooks
  (`X-LendLoop-Signature: sha256=<hex>`); n8n verifies before processing and
  throws on mismatch. n8n signs every callback to Convex; the Convex HTTP
  endpoints verify and return 401 on a bad signature.
- **Secrets only in environment variables** — Convex: `N8N_WEBHOOK_SECRET`;
  n8n: `LENDLOOP_WEBHOOK_SECRET` (same value). Nothing secret is stored in
  the database or in the workflow JSON (the SMTP credential is a named
  placeholder you link after import).
- **Delivery claims and receipts.** Before sending, n8n claims a stable
  `eventId` through a signed Convex endpoint. A repeated event skips SMTP,
  and a receipt updates the same row. Reminder IDs include the UTC date.
  A claim without a receipt needs manual review against the mail provider’s
  delivery record. A retry from the trigger skips the existing claim.

| # | File | Trigger | Does |
| --- | --- | --- | --- |
| 01 | `n8n/01-borrow-request-notification.json` | Webhook `POST /webhook/lendloop/borrow-request` from a Convex scheduled action | Verify HMAC → claim delivery → email owner → record the signed receipt |
| 02 | `n8n/02-daily-overdue-reminders.json` | Schedule, daily 09:00 | Fetch overdue loans → claim each reminder → email borrower → record the signed receipt |
| 03 | `n8n/03-error-workflow.json` | n8n Error Trigger | Signed failure record to `POST /n8n/error-logged`. **After importing, paste this workflow's ID into the Error Workflow setting of 01 and 02** (their exports carry the placeholder `REPLACE_WITH_ERROR_WORKFLOW_ID`) |

Convex HTTP endpoints are served from the **site URL**
(`https://<deployment>.convex.site`), not the client API URL
(`.convex.cloud`) — see `convex/http.ts`.

## Data model (Convex, `convex/schema.ts`)

- `users` — Clerk identity (`tokenIdentifier`, subject), name, email, `role`.
- `tools` — owner, name/description/category/condition, optional
  neighbourhood-level `location`, `available` flag. Approving a request
  flips `available` off. A tool can be relisted after its last active loan
  is marked returned.
- `borrowRequests` — tool, borrower, denormalised owner, `startDate` /
  `endDate` (`YYYY-MM-DD`), status
  `pending → approved → returned`, or `pending → declined / cancelled`.
- `notificationLog` — automation ledger keyed by `eventId`, with a
  reservation and optional SMTP receipt for each email.

**Data minimisation:** no postal addresses (neighbourhood only, optional),
no phone numbers, and a 200-character limit on borrow notes. The public
owner label uses the display name or “Neighbour”. Account emails are used
for backend coordination through the request flow.

## Local setup

Local setup uses Node 22, a Clerk application, a Convex deployment and a
self-hosted n8n instance. Docker Compose is available for a local n8n preview.

### 1. Install

```bash
npm ci
```

### 2. Clerk

1. Create an application in the Clerk dashboard.
2. Create a **JWT template named `convex`** and note its Issuer URL.
3. Copy `.env.example` to `.env.local` and fill in
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.

### 3. Convex

```bash
npx convex dev          # creates/links a deployment, writes NEXT_PUBLIC_CONVEX_URL,
                        # regenerates convex/_generated with full types
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-clerk-issuer>
npx convex env set ADMIN_EMAILS you@example.com
```

Set `N8N_WEBHOOK_SECRET` in the Convex dashboard. For
`N8N_BORROW_WEBHOOK_URL`, use an n8n webhook URL reachable from the
selected Convex deployment. A hosted deployment needs an independently
reachable HTTPS endpoint.

The typed files in `convex/_generated` allow offline type-checking. Convex
codegen replaces them when you connect a deployment.

### 4. Run the app

```bash
npm run dev             # http://localhost:3000
```

Sign in, and your user record is created in Convex automatically
(`users.store`). The email in `ADMIN_EMAILS` gets the admin role.

### 5. n8n

```bash
# .env next to docker-compose.yml:
#   LENDLOOP_WEBHOOK_SECRET=<same value as Convex N8N_WEBHOOK_SECRET>
#   CONVEX_SITE_URL=https://<your-deployment>.convex.site
docker compose up -d    # http://localhost:5678
```

Then: create the n8n owner account → import the three files from `n8n/` →
on each email node, create/select your SMTP credential and fix the
`lendloop@example.com` sender → in workflows 01/02 set the Error Workflow
to workflow 03 → activate workflows 01 and 02. If n8n is not on the same
machine as the browser, update `N8N_BORROW_WEBHOOK_URL` on the Convex side
to the reachable production webhook URL (`/webhook/...`, not
`/webhook-test/...`).

### Verify the loop end-to-end

1. Sign in as user A, list a tool. Sign in as user B (second browser
   profile), request it for tomorrow → A receives the workflow-01 email,
   and a `notificationLog` row with `eventId = borrow-request:<id>` appears
   (Convex dashboard → Data).
2. A approves; set the request's `endDate` to yesterday in the dashboard;
   run workflow 02 manually → B gets a reminder and a
   `overdue:<id>:<today>` log row appears. Run it again and confirm the
   workflow skips the send and keeps the same row.

## What I would change for production

- **Real email provider + verified domain** (the SMTP node is a placeholder;
  add SPF/DKIM and a proper from-address), plus delivery/bounce tracking.
- **Rate limiting & abuse controls** on the public board and request
  creation; CAPTCHA on sign-up via Clerk's built-in protections.
- **Reminders policy**: escalate (e.g. day 1 email, day 3 email + owner CC),
  and a "returned late" flag on the borrower record instead of only logs.
- **Availability calendar**: current model is one active loan per tool via a
  boolean; a production version should model date-range conflicts across
  different borrowers.
- **Integration tests**: run the configured Clerk, Convex, n8n and test
  mailboxes together, including recovery after an uncertain SMTP result.
- **Observability**: ship `notificationLog` errors to an alert channel;
  today the error workflow records them in Convex, which still needs a
  human (or another small workflow) to look.
- **Data retention**: set a limit for workflow execution logs and review
  which details support teams actually need to retain.

## Repository layout

```
app/                 Next.js App Router pages (board, /my, /admin)
components/          Clerk+Convex provider, header, forms
convex/              schema, functions (permission layer), HTTP endpoints,
                     HMAC + auth helpers, outbound notification action
n8n/                 importable workflow exports (01 notify, 02 overdue,
                     03 error)
docker-compose.yml   self-hosted n8n
SUBMISSION.md        delivery notes for this take-home
```
