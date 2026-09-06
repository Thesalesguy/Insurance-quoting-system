const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
    validateWebhookVerification,
    validateIncomingWebhookPayload
} = require('../src/validators/whatsappValidator');
const { getOrCreateSession, updateSession, resetSession, SESSION_STATES } = require('../src/services/sessionStore');
const { classifyWebhookPayload } = require('../src/controllers/whatsappController');

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

test('classifyWebhookPayload detects a messages-only payload', () => {
    const result = classifyWebhookPayload({
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
    assert.equal(result.hasMessages, true);
    assert.equal(result.hasStatuses, false);
    assert.equal(result.messages.length, 1);
    assert.equal(result.statuses.length, 0);
});

test('classifyWebhookPayload detects a statuses-only payload', () => {
    const result = classifyWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [
            {
                changes: [
                    {
                        value: {
                            statuses: [
                                {
                                    status: 'failed',
                                    recipient_id: '255700000000',
                                    errors: [{ code: 131047 }]
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    });
    assert.equal(result.hasMessages, false);
    assert.equal(result.hasStatuses, true);
    assert.equal(result.statuses[0].status, 'failed');
    assert.equal(result.statuses[0].recipient_id, '255700000000');
    assert.equal(result.statuses[0].errors[0].code, 131047);
});

test('classifyWebhookPayload detects a payload containing both messages and statuses', () => {
    const result = classifyWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [
            {
                changes: [
                    { value: { messages: [{ from: '255700000000', type: 'text', text: { body: 'hi' } }] } },
                    { value: { statuses: [{ status: 'delivered', recipient_id: '255700000000' }] } }
                ]
            }
        ]
    });
    assert.equal(result.hasMessages, true);
    assert.equal(result.hasStatuses, true);
});

test('classifyWebhookPayload reports neither for a payload with no entry array', () => {
    const result = classifyWebhookPayload({ object: 'whatsapp_business_account' });
    assert.equal(result.hasMessages, false);
    assert.equal(result.hasStatuses, false);
    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.statuses, []);
});

test('POST /api/v1/whatsapp/webhook logs message details for a messages payload', async (t) => {
    const logLines = [];
    t.mock.method(console, 'log', (...args) => {
        logLines.push(args.join(' '));
    });

    await withServer(async (baseUrl) => {
        await fetch(`${baseUrl}/api/v1/whatsapp/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                object: 'whatsapp_business_account',
                entry: [
                    {
                        changes: [
                            {
                                value: {
                                    messages: [
                                        { from: '255700000000', type: 'text', text: { body: 'hello' } }
                                    ]
                                }
                            }
                        ]
                    }
                ]
            })
        });
    });

    mock.reset();

    assert.ok(logLines.some((line) => line.includes('messages: true, statuses: false')));
    assert.ok(
        logLines.some(
            (line) => line.includes('from: 255700000000') && line.includes('type: text') && line.includes('text: hello')
        )
    );
});

test('POST /api/v1/whatsapp/webhook logs status details for a statuses payload', async (t) => {
    const logLines = [];
    t.mock.method(console, 'log', (...args) => {
        logLines.push(args.join(' '));
    });

    await withServer(async (baseUrl) => {
        await fetch(`${baseUrl}/api/v1/whatsapp/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                object: 'whatsapp_business_account',
                entry: [
                    {
                        changes: [
                            {
                                value: {
                                    statuses: [
                                        {
                                            status: 'failed',
                                            recipient_id: '255700000000',
                                            errors: [{ code: 131047 }]
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ]
            })
        });
    });

    mock.reset();

    assert.ok(logLines.some((line) => line.includes('messages: false, statuses: true')));
    assert.ok(
        logLines.some(
            (line) =>
                line.includes('status: failed') &&
                line.includes('recipientId: 255700000000') &&
                line.includes('errorCode: 131047')
        )
    );
});
