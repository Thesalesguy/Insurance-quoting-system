/**
 * Single shared entry point for calculating a premium quote.
 * Wraps the existing validator + rating engine so that both the HTTP
 * quote API and the WhatsApp conversation flow go through exactly the
 * same validation and calculation path — no rating logic is duplicated
 * or reimplemented anywhere else.
 */

const { calculateTIRAComprehensiveMotorPremium } = require('../../ratingEngine');
const { validateQuoteRequest } = require('../validators/quoteValidator');

// Statutory VAT applied on top of the rating engine's payable premium.
// Kept here (not in ratingEngine.js) because VAT is a tax overlay, not an
// actuarial rating formula -- the engine's own payablePremiumTZS is left
// untouched and still means exactly what it always has (pre-VAT premium).
const VAT_RATE = 0.18;

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

    // Round VAT first, then add to the (already rounded) pre-VAT premium,
    // so the displayed line items always sum exactly to the displayed total.
    const vatAmount = Math.round(result.summary.payablePremiumTZS * VAT_RATE);
    const payablePremiumWithVAT = result.summary.payablePremiumTZS + vatAmount;

    return {
        success: true,
        result: {
            ...result,
            summary: {
                ...result.summary,
                vatRate: VAT_RATE,
                vatAmount,
                payablePremiumWithVAT
            }
        }
    };
}

module.exports = { calculateQuote, VAT_RATE };
