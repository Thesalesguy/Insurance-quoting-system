const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
    validateWebhookVerification,
    validateIncomingWebhookPayload
} = require('../src/validators/whatsappValidator');
const { getOrCreateSession, updateSession, resetSession, SESSION_STATES } = require('../src/services/sessionStore');

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

test('validateWebhookVerification accepts a correct handshake', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    const result = validateWebhookVerification({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-verify-token',
        'hub.challenge': '12345'
    });
    assert.equal(result.valid, true);
    assert.equal(result.challenge, '12345');
    delete process.env.WHATSAPP_VERIFY_TOKEN;
});

test('validateWebhookVerification rejects a token mismatch', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'expected-token';
    const result = validateWebhookVerification({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': '12345'
    });
    assert.equal(result.valid, false);
    delete process.env.WHATSAPP_VERIFY_TOKEN;
});

test('validateWebhookVerification rejects when server has no verify token configured', () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const result = validateWebhookVerification({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'anything',
        'hub.challenge': '12345'
    });
    assert.equal(result.valid, false);
});

test('validateIncomingWebhookPayload rejects a non-WhatsApp payload', () => {
    const result = validateIncomingWebhookPayload({ object: 'page' });
    assert.equal(result.valid, false);
});

test('validateIncomingWebhookPayload extracts messages from a valid payload', () => {
    const result = validateIncomingWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [
            {
                changes: [
                    {
                        value: {
                            messages: [{ from: '255700000000', type: 'text', text: { body: 'hi' } }]
                        }
                    }
                ]
            }
        ]
    });
    assert.equal(result.valid, true);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].from, '255700000000');
});

test('sessionStore creates, updates, and resets a session', () => {
    const phone = 'test-phone-123';
    resetSession(phone);

    const created = getOrCreateSession(phone);
    assert.equal(created.state, SESSION_STATES.NEW);

    const updated = updateSession(phone, { state: SESSION_STATES.IN_PROGRESS });
    assert.equal(updated.state, SESSION_STATES.IN_PROGRESS);
    assert.equal(getOrCreateSession(phone).state, SESSION_STATES.IN_PROGRESS);

    resetSession(phone);
    assert.equal(getOrCreateSession(phone).state, SESSION_STATES.NEW);
});

test('GET /api/v1/whatsapp/webhook echoes the challenge on a valid handshake', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'integration-token';
    await withServer(async (baseUrl) => {
        const res = await fetch(
            `${baseUrl}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=integration-token&hub.challenge=echo-me`
        );
        const text = await res.text();
        assert.equal(res.status, 200);
        assert.equal(text, 'echo-me');
    });
    delete process.env.WHATSAPP_VERIFY_TOKEN;
});

test('GET /api/v1/whatsapp/webhook rejects an invalid verify token', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'integration-token';
    await withServer(async (baseUrl) => {
        const res = await fetch(
            `${baseUrl}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=echo-me`
        );
        assert.equal(res.status, 403);
    });
    delete process.env.WHATSAPP_VERIFY_TOKEN;
});

test('POST /api/v1/whatsapp/webhook acknowledges a valid payload with 200', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/whatsapp/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                object: 'whatsapp_business_account',
                entry: [{ changes: [{ value: { messages: [] } }] }]
            })
        });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
    });
});

test('POST /api/v1/whatsapp/webhook rejects a non-WhatsApp payload with 400', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/whatsapp/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ object: 'not_whatsapp' })
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
    });
});

test('existing POST /api/v1/quotes behavior is unaffected', async () => {
    await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vehicleClass: 'private_car',
                coverType: 'comprehensive',
                vehicleValue: 25000000
            })
        });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.summary.payablePremiumTZS, 875000);
    });
});
