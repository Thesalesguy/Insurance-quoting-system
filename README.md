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

## Project structure

```
ratingEngine.js           # premium calculation math — no HTTP/UI knowledge
index.html                # browser demo UI, calls ratingEngine.js directly
server.js                 # API entry point
src/app.js                # Express app assembly (routes, error handling)
src/routes/                # route definitions
src/controllers/           # request/response glue between routes and the engine
src/validators/             # request validation/sanitization (the API's boundary)
src/data/sampleQuotes.js   # example payloads for rapid testing
test/                      # node:test unit + HTTP integration tests
```
