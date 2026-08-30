const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { sampleQuotes } = require('../src/data/sampleQuotes');

function startServer() {
    const app = createApp();
    return new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });
}

async function withServer(fn) {
    const server = await startServer();
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await fn(baseUrl);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('GET /health returns ok', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/health`);
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.status, 'ok');
    });
});

test('GET /api/v1/metadata returns enumerations', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/metadata`);
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.ok(body.data.vehicleClasses.includes('private_car'));
        assert.ok(body.data.coverTypes.includes('comprehensive'));
    });
});

test('POST /api/v1/quotes returns a structured premium payload for valid input', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sampleQuotes.privateCarComprehensive)
        });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.ok(body.summary.payablePremiumTZS > 0);
        assert.equal(body.complianceDetails.currency, 'TZS');
    });
});

test('POST /api/v1/quotes rejects invalid input with 400 and error details', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vehicleClass: 'not_a_real_class' })
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
        assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
    });
});

test('POST /api/v1/quotes rejects malformed JSON', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{ not valid json'
        });
        assert.equal(res.status, 400);
    });
});

test('unknown route returns 404', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/does-not-exist`);
        assert.equal(res.status, 404);
    });
});
