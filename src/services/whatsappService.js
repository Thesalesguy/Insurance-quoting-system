/**
 * Thin client for Meta's WhatsApp Cloud API (Graph API).
 * Credentials are read from environment variables only — never hard-coded —
 * and only at call time, so the server can boot and serve the rest of the
 * API fine even before these are configured.
 */

const DEFAULT_GRAPH_API_VERSION = 'v21.0';

function getConfig() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;

    if (!accessToken || !phoneNumberId) {
        throw new Error(
            'WhatsApp is not configured: set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.'
        );
    }

    return { accessToken, phoneNumberId, apiVersion };
}

/**
 * Sends a plain text WhatsApp message via the Graph API.
 * @param {string} to - recipient's WhatsApp number in E.164 format (no leading '+')
 * @param {string} body - message text
 */
async function sendTextMessage(to, body) {
    const { accessToken, phoneNumberId, apiVersion } = getConfig();

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body }
        })
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`WhatsApp Graph API request failed (${response.status}): ${errorBody}`);
    }

    return response.json();
}

module.exports = { sendTextMessage, getConfig };
