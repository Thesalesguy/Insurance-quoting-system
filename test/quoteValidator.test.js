const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQuoteRequest } = require('../src/validators/quoteValidator');

test('rejects a non-object body', () => {
    const result = validateQuoteRequest(null);
    assert.equal(result.valid, false);
});

test('rejects missing required fields', () => {
    const result = validateQuoteRequest({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('vehicleClass')));
    assert.ok(result.errors.some((e) => e.includes('coverType')));
    assert.ok(result.errors.some((e) => e.includes('vehicleValue')));
});

test('requires subType for passenger_carrying vehicles', () => {
    const result = validateQuoteRequest({
        vehicleClass: 'passenger_carrying',
        coverType: 'comprehensive',
        vehicleValue: 1000000
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('subType')));
});

test('accepts a well-formed private car request and applies defaults', () => {
    const result = validateQuoteRequest({
        vehicleClass: 'private_car',
        coverType: 'comprehensive',
        vehicleValue: 25000000
    });
    assert.equal(result.valid, true);
    assert.equal(result.data.hasClaimRecord, false);
    assert.equal(result.data.addonCarTracker, false);
    assert.equal(result.data.vehicleValue, 25000000);
});

test('normalizes negative and non-numeric add-on values to safe defaults', () => {
    const result = validateQuoteRequest({
        vehicleClass: 'private_car',
        coverType: 'tpo',
        vehicleValue: 1000000,
        tonnage: -5,
        addonIncreasedTPPD: 'not-a-number'
    });
    assert.equal(result.valid, true);
    assert.equal(result.data.tonnage, 0);
    assert.equal(result.data.addonIncreasedTPPD, 0);
});
