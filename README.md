# Insurance-quoting-system
AI-assisted insurance broker quoting platform.

The premium calculation math (`ratingEngine.js`) is a pure, dependency-free
function. It is consumed two ways:

- `index.html` — a Tailwind/vanilla-JS demo UI that calls it directly in the browser.
- The Node.js API (`server.js` + `src/`) — a stateless HTTP layer for integrating
  the quoting engine into other systems.

## Running the API

```bash
npm install
npm start          # starts on PORT env var, default 3000
npm run dev        # same, with --watch for local development
```

## Running tests

```bash
npm test
```

## Endpoints

### `GET /health`
Liveness check.

```json
{ "success": true, "status": "ok" }
```

### `GET /api/v1/metadata`
Returns the valid enumerations for building a request (vehicle classes, cover
types, passenger sub-types) — useful for populating front-end form options.

### `GET /api/v1/sample-quotes`
Returns a set of ready-to-use example request bodies (see
`src/data/sampleQuotes.js`) for rapid testing/integration.

### `POST /api/v1/quotes`
Calculates a premium quote. Body fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `vehicleClass` | string | yes | one of the values from `/api/v1/metadata` |
| `coverType` | string | yes | `comprehensive`, `tpft`, or `tpo` |
| `vehicleValue` | number | yes | sum insured, in TZS |
| `subType` | string | required for `passenger_carrying` | e.g. `daladala`, `bus_school` |
| `hasClaimRecord` | boolean | no (default `false`) | |
| `carryingPassengers` | boolean | no (default `false`) | motorcycles/three-wheelers |
| `tonnage` | number | no (default `0`) | commercial goods TPO tiering |
| `seatsCount` | integer | no (default `0`) | passenger-carrying vehicles |
| `isTatoaTaboaMember` | boolean | no (default `false`) | 5% association discount |
| `isEligibleFleet` | boolean | no (default `false`) | 20% fleet discount |
| `addonExcessBuyBack` | boolean | no (default `false`) | 10% OD loading |
| `addonLossOfUse` | boolean | no (default `false`) | private cars only |
| `addonGeographical` | boolean | no (default `false`) | 5% OD loading |
| `addonIncreasedTPPD` | number | no (default `0`) | amount above the base 50M limit |
| `addonCarTracker` | boolean | no (default `false`) | 5% discount |

Example:

```bash
curl -X POST http://localhost:3000/api/v1/quotes \
  -H "Content-Type: application/json" \
  -d '{
    "vehicleClass": "private_car",
    "coverType": "comprehensive",
    "vehicleValue": 25000000,
    "addonCarTracker": true
  }'
```

Response — the raw structured payload from the rating engine:

```json
{
  "success": true,
  "summary": {
    "calculatedBasePremium": 875000,
    "totalAddonLoadings": 0,
    "totalDiscountsDeducted": 43750,
    "payablePremiumTZS": 831250
  },
  "complianceDetails": {
    "currency": "TZS",
    "excessMandateRule": "5% of Claim, Min TZS 350,000 (Doubled in case of Total Theft).",
    "antiMoneyLaunderingRequirement": "Warranted: Proposal form must be counter-signed by a licensed broker under TIRA AML/CFT regulations.",
    "systemLogs": ["Applied 5% Tracking Device Installation discount: -TZS 43750"]
  }
}
```

Invalid input returns `400`:

```json
{ "success": false, "errors": ["vehicleClass is required and must be one of: ..."] }
```

## WhatsApp Cloud API webhook (infrastructure only — not yet connected)

This stage adds the webhook plumbing needed for a future Meta WhatsApp Cloud
API integration. It does **not** connect to Meta, run any AI, use a
database, or implement the quotation conversation — it only makes the API
able to receive and acknowledge webhook events once you connect it.

### `GET /api/v1/whatsapp/webhook`
Meta's webhook verification handshake. Responds `200` with the echoed
`hub.challenge` if `hub.mode=subscribe` and `hub.verify_token` matches the
`WHATSAPP_VERIFY_TOKEN` env var; otherwise `403`.

### `POST /api/v1/whatsapp/webhook`
Receives WhatsApp events. Validates the payload is a
`whatsapp_business_account` object (`400` otherwise), immediately
acknowledges Meta with `200` (Meta retries aggressively on slow/non-200
responses), then asynchronously processes any inbound messages — updating
an in-memory session (`src/services/sessionStore.js`) and sending a
placeholder acknowledgement reply via `src/services/whatsappService.js`.
Send failures (e.g. credentials not yet configured) are caught and logged;
they never crash the process or affect other requests.

### Required environment variables

| Variable | Purpose |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp phone number ID to send from |
| `WHATSAPP_VERIFY_TOKEN` | Shared secret you choose and enter in Meta's webhook setup |
| `WHATSAPP_GRAPH_API_VERSION` | Optional, defaults to `v21.0` |

None of these are hard-coded anywhere. Copy `.env.example` to `.env` for
local development. On Render, they're declared in `render.yaml` as
`sync: false` — set the real values manually in the service's **Environment**
tab in the Render dashboard; nothing here works until you do.

### What's intentionally not built yet
No Meta app is connected, no messages are sent proactively, there's no AI
integration, and the quotation conversation itself isn't implemented — a
message just gets a placeholder reply. The in-memory session store
(`src/services/sessionStore.js`) is a foundation for that conversation and
is ephemeral (resets on restart) since no database exists yet.

## Deploying to production (Render)

This repo includes a `render.yaml` Blueprint that provisions the API as a
Render web service.

1. Push/merge this repo to `main` (already done if you're reading this on `main`).
2. In the [Render Dashboard](https://dashboard.render.com), choose **New > Blueprint**
   and connect the `Thesalesguy/Insurance-quoting-system` GitHub repo. Render will
   detect `render.yaml` and provision the `insurance-quoting-api` web service
   automatically (build: `npm ci`, start: `npm start`, health check: `/health`).
3. Render assigns the `PORT` env var itself — `server.js` already reads it, no
   config needed.
4. Every subsequent push to `main` auto-deploys.

This step requires access to a Render account and can't be completed from
here — connecting the repo and clicking deploy is a one-time manual step for
whoever owns the Render account.

## Project structure

```
ratingEngine.js           # premium calculation math — no HTTP/UI knowledge
index.html                # browser demo UI, calls ratingEngine.js directly
server.js                 # API entry point
src/app.js                # Express app assembly (routes, error handling)
src/routes/                # route definitions (quotes + whatsapp)
src/controllers/           # request/response glue between routes and the engine/services
src/validators/             # request validation/sanitization (the API's boundary)
src/services/               # WhatsApp Graph API client + in-memory session store
src/data/sampleQuotes.js   # example payloads for rapid testing
test/                      # node:test unit + HTTP integration tests
```
