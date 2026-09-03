const { validateWebhookVerification, validateIncomingWebhookPayload } = require('../validators/whatsappValidator');
const { getOrCreateSession, updateSession, SESSION_STATES } = require('../services/sessionStore');
const whatsappService = require('../services/whatsappService');

function verifyWebhook(req, res) {
    const result = validateWebhookVerification(req.query);

    if (!result.valid) {
        return res.status(403).json({ success: false, errors: [result.reason] });
    }

    // Meta requires the raw challenge string echoed back as the response body.
    return res.status(200).send(result.challenge);
}

/**
 * Placeholder handling for an inbound message: acknowledges the sender so
 * the webhook is visibly "live" end-to-end. The actual quotation
 * conversation flow is built on top of this in a later stage.
 */
async function processIncomingMessages(messages) {
    const outcomes = await Promise.allSettled(
        messages.map(async (message) => {
            const from = message && message.from;
            if (!from) return;

            updateSession(from, { state: SESSION_STATES.IN_PROGRESS });
            getOrCreateSession(from);

            await whatsappService.sendTextMessage(
                from,
                "Thanks for messaging us! Our motor insurance quoting assistant is coming online soon."
            );
        })
    );

    outcomes
        .filter((outcome) => outcome.status === 'rejected')
        .forEach((outcome) => console.error('Failed to process WhatsApp message:', outcome.reason));
}

function receiveWebhook(req, res) {
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

module.exports = { verifyWebhook, receiveWebhook };
