const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote, VAT_RATE } = require('../src/services/quoteService');

const BASE_INPUT = {
    vehicleClass: 'private_car',
    coverType: 'comprehensive',
    vehicleValue: 25000000,
    hasClaimRecord: false,
    carryingPassengers: false,
    tonnage: 0,
    seatsCount: 0,
    isTatoaTaboaMember: false,
    isEligibleFleet: false,
    addonExcessBuyBack: false,
    addonLossOfUse: false,
    addonGeographical: false,
    addonIncreasedTPPD: 0,
    addonCarTracker: false
};

test('VAT_RATE is 18%', () => {
    assert.equal(VAT_RATE, 0.18);
});

test('calculateQuote adds VAT fields without changing payablePremiumTZS', () => {
    const outcome = calculateQuote(BASE_INPUT);
    assert.equal(outcome.success, true);

    const { summary } = outcome.result;
    assert.equal(summary.payablePremiumTZS, 875000);
    assert.equal(summary.vatRate, 0.18);
    assert.equal(summary.vatAmount, 157500); // 875,000 * 0.18
    assert.equal(summary.payablePremiumWithVAT, 1032500); // 875,000 + 157,500
});

test('VAT is always exactly 18% of payablePremiumTZS, rounded, and adds up cleanly', () => {
    const outcome = calculateQuote({
        ...BASE_INPUT,
        addonCarTracker: true,
        addonExcessBuyBack: true,
        addonIncreasedTPPD: 20000000
    });
    const { summary } = outcome.result;

    assert.equal(summary.vatAmount, Math.round(summary.payablePremiumTZS * 0.18));
    assert.equal(summary.payablePremiumWithVAT, summary.payablePremiumTZS + summary.vatAmount);
});

test('invalid input still fails validation before VAT is ever computed', () => {
    const outcome = calculateQuote({ vehicleClass: 'not_real' });
    assert.equal(outcome.success, false);
    assert.ok(Array.isArray(outcome.errors) && outcome.errors.length > 0);
});
