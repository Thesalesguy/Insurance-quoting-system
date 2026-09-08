/**
 * Single shared entry point for calculating a premium quote.
 * Wraps the existing validator + rating engine so that both the HTTP
 * quote API and the WhatsApp conversation flow go through exactly the
 * same validation and calculation path — no rating logic is duplicated
 * or reimplemented anywhere else.
 */

const { calculateTIRAComprehensiveMotorPremium } = require('../../ratingEngine');
const { validateQuoteRequest } = require('../validators/quoteValidator');

/**
 * @param {unknown} rawInput - raw, untrusted quote request fields
 * @returns {{ success: true, result: object } | { success: false, errors: string[] }}
 */
function calculateQuote(rawInput) {
    const validation = validateQuoteRequest(rawInput);

    if (!validation.valid) {
        return { success: false, errors: validation.errors };
    }

    const result = calculateTIRAComprehensiveMotorPremium(validation.data);

    return { success: true, result };
}

module.exports = { calculateQuote };
