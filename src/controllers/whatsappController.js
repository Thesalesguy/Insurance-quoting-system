const { validateWebhookVerification, validateIncomingWebhookPayload } = require('../validators/whatsappValidator');
const whatsappService = require('../services/whatsappService');
const conversationService = require('../services/conversationService');

/**
 * Diagnostic-only: walks the raw webhook body and separates out any
 * `messages` and `statuses` entries, independent of (and without altering)
 * validateIncomingWebhookPayload's own extraction used for actual processing.
 */
function classifyWebhookPayload(body) {
    const messages = [];
    const statuses = [];

    const entries = Array.isArray(body && body.entry) ? body.entry : [];
    for (const entry of entries) {
        const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];
        for (const change of changes) {
            const value = change && change.value;
            if (value && Array.isArray(value.messages)) {
                messages.push(...value.messages);
            }
            if (value && Array.isArray(value.statuses)) {
                statuses.push(...value.statuses);
            }
        }
    }

    return {
        hasMessages: messages.length > 0,
        hasStatuses: statuses.length > 0,
        messages,
        statuses
    };
}

/**
 * TEMPORARY DIAGNOSTIC LOGGING — logs whether an incoming webhook payload
 * contains messages, statuses, or both, plus a few non-sensitive fields
 * from each. No access tokens, App Secret, or other credentials are ever
 * logged. Remove once webhook delivery is confirmed working end-to-end.
 */
function logWebhookPayload(body) {
    const { hasMessages, hasStatuses, messages, statuses } = classifyWebhookPayload(body);

    console.log(`WHATSAPP WEBHOOK PAYLOAD TYPE - messages: ${hasMessages}, statuses: ${hasStatuses}`);

    messages.forEach((message) => {
        const from = message && message.from;
        const type = message && message.type;
        const text = message && message.text && message.text.body;
        console.log(`WHATSAPP MESSAGE - from: ${from}, type: ${type}, text: ${text}`);
    });

    statuses.forEach((status) => {
        const state = status && status.status;
        const recipientId = status && status.recipient_id;
        const errorCode = status && Array.isArray(status.errors) && status.errors.length > 0
            ? status.errors[0].code
            : undefined;
        console.log(`WHATSAPP STATUS - status: ${state}, recipientId: ${recipientId}, errorCode: ${errorCode}`);
    });
}

function verifyWebhook(req, res) {
    const result = validateWebhookVerification(req.query);

    if (!result.valid) {
        return res.status(403).json({ success: false, errors: [result.reason] });
    }

    // Meta requires the raw challenge string echoed back as the response body.
    return res.status(200).send(result.challenge);
}

/**
 * Advances each sender's private-car quoting conversation by one turn
 * (via conversationService, which is the only thing that touches
 * sessionStore/quoteService here) and sends back the resulting reply.
 */
async function processIncomingMessages(messages) {
    const outcomes = await Promise.allSettled(
        messages.map(async (message) => {
            const from = message && message.from;
            if (!from) return;

            const text = (message.type === 'text' && message.text && message.text.body) || '';
            const replyText = conversationService.handleIncomingMessage(from, text);

            await whatsappService.sendTextMessage(from, replyText);
        })
    );

    outcomes
        .filter((outcome) => outcome.status === 'rejected')
        .forEach((outcome) => console.error('Failed to process WhatsApp message:', outcome.reason));
}

function receiveWebhook(req, res) {
    // TEMPORARY DIAGNOSTIC LOGGING — confirms whether Meta's POST reaches
    // this service at all, and what kind of payload it carries.
    console.log(`WHATSAPP WEBHOOK POST RECEIVED - ${req.method} ${req.originalUrl}`);
    logWebhookPayload(req.body);

    const validation = validateIncomingWebhookPayload(req.body);

    if (!validation.valid) {
        return res.status(400).json({ success: false, errors: validation.errors });
    }

    // Acknowledge immediately: Meta expects a fast 200 and retries aggressively otherwise.
    res.status(200).json({ success: true });

    processIncomingMessages(validation.messages).catch((err) => {
        console.error('Unexpected error processing WhatsApp webhook payload:', err);
    });
}

module.exports = { verifyWebhook, receiveWebhook, classifyWebhookPayload };
