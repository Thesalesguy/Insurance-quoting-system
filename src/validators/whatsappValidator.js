/**
 * Validation for Meta WhatsApp Cloud API webhook traffic.
 * This is the boundary for both the verification handshake (GET) and
 * incoming event payloads (POST) — nothing here trusts the caller.
 */

/**
 * Validates Meta's webhook verification handshake query params.
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 * @param {object} query - req.query
 * @returns {{ valid: true, challenge: string } | { valid: false, reason: string }}
 */
function validateWebhookVerification(query) {
    const mode = query && query['hub.mode'];
    const token = query && query['hub.verify_token'];
    const challenge = query && query['hub.challenge'];

    if (typeof mode !== 'string' || typeof token !== 'string' || typeof challenge !== 'string') {
        return { valid: false, reason: 'Missing required hub.mode, hub.verify_token, or hub.challenge.' };
    }

    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expectedToken) {
        return { valid: false, reason: 'WHATSAPP_VERIFY_TOKEN is not configured on the server.' };
    }

    if (mode !== 'subscribe' || token !== expectedToken) {
        return { valid: false, reason: 'Verify token mismatch or unsupported hub.mode.' };
    }

    return { valid: true, challenge };
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the top-level shape of an incoming webhook payload and extracts
 * any inbound WhatsApp messages from it.
 * @param {unknown} body - req.body
 * @returns {{ valid: true, messages: object[] } | { valid: false, errors: string[] }}
 */
function validateIncomingWebhookPayload(body) {
    if (!isPlainObject(body)) {
        return { valid: false, errors: ['Request body must be a JSON object.'] };
    }

    if (body.object !== 'whatsapp_business_account') {
        return { valid: false, errors: ['Unsupported webhook object type.'] };
    }

    if (!Array.isArray(body.entry)) {
        return { valid: false, errors: ['Missing or invalid entry array.'] };
    }

    const messages = [];
    for (const entry of body.entry) {
        const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];
        for (const change of changes) {
            const incoming = change && change.value && change.value.messages;
            if (Array.isArray(incoming)) {
                messages.push(...incoming);
            }
        }
    }

    return { valid: true, messages };
}

module.exports = { validateWebhookVerification, validateIncomingWebhookPayload };
