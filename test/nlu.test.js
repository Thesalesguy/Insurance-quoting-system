/**
 * Unit tests for the deterministic, rule-based NLU fact extractor
 * (Phase 3D). These test extractFacts() in isolation -- no session, no
 * conversation state, no quoteService/ratingEngine involved -- to prove
 * the extraction rules themselves are correct and that the module never
 * produces anything resembling a premium.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const nlu = require('../src/services/nlu');
const quoteValidator = require('../src/validators/quoteValidator');

function factValue(extraction, field) {
    const fact = extraction.facts[field];
    return fact ? fact.value : undefined;
}

function factConfidence(extraction, field) {
    const fact = extraction.facts[field];
    return fact ? fact.confidence : undefined;
}

// =======================================================================
// 1. Single-fact extraction
// =======================================================================

test('extracts a single high-confidence coverType fact', () => {
    const result = nlu.extractFacts('I want comprehensive cover');
    assert.equal(factValue(result, 'coverType'), 'comprehensive');
    assert.equal(factConfidence(result, 'coverType'), 'high');
});

test('extracts a single vehicleValue fact from "million" phrasing', () => {
    const result = nlu.extractFacts('worth 25 million');
    assert.equal(factValue(result, 'vehicleValue'), 25000000);
});

// =======================================================================
// 2. Multiple facts from one message
// =======================================================================

test('extracts coverType, vehicleValue and hasClaimRecord from one sentence', () => {
    const result = nlu.extractFacts('I want comprehensive for my 35 million Toyota Noah, no claims.');
    assert.equal(factValue(result, 'coverType'), 'comprehensive');
    assert.equal(factValue(result, 'vehicleValue'), 35000000);
    assert.equal(factValue(result, 'hasClaimRecord'), false);
    // Vehicle model names are never treated as a class signal.
    assert.equal(factValue(result, 'vehicleClass'), undefined);
});

test('extracts vehicleClass, coverType and carryingPassengers together', () => {
    const result = nlu.extractFacts('I need third party for my boda boda. I use it for passengers.');
    assert.equal(factValue(result, 'vehicleClass'), 'motorcycle');
    assert.equal(factValue(result, 'coverType'), 'tpo');
    assert.equal(factValue(result, 'carryingPassengers'), true);
});

// =======================================================================
// 3 & 4. Partial / out-of-order facts
// =======================================================================

test('a message that only answers a later question still extracts that fact', () => {
    const result = nlu.extractFacts('no claims please');
    assert.equal(factValue(result, 'hasClaimRecord'), false);
    assert.equal(Object.keys(result.facts).length, 1);
});

test('facts are extracted the same regardless of the order they appear in the sentence', () => {
    const a = nlu.extractFacts('comprehensive, no claims, worth 10 million');
    const b = nlu.extractFacts('worth 10 million, no claims, comprehensive');
    assert.equal(factValue(a, 'coverType'), factValue(b, 'coverType'));
    assert.equal(factValue(a, 'hasClaimRecord'), factValue(b, 'hasClaimRecord'));
    assert.equal(factValue(a, 'vehicleValue'), factValue(b, 'vehicleValue'));
});

// =======================================================================
// 5. Corrections
// =======================================================================

test('a trailing ", not X" correction clause is stripped before extraction', () => {
    const result = nlu.extractFacts("Actually it's a school bus, not a private bus");
    assert.equal(factValue(result, 'subType'), 'bus_school');
    assert.notEqual(factValue(result, 'subType'), 'bus_private');
});

test('corrections array flags a new value that differs from the known one', () => {
    const result = nlu.extractFacts('actually comprehensive', { coverType: 'tpo' });
    assert.ok(result.corrections.includes('coverType'));
});

test('no correction is flagged when the new value matches what was already known', () => {
    const result = nlu.extractFacts('comprehensive please', { coverType: 'comprehensive' });
    assert.ok(!result.corrections.includes('coverType'));
});

// =======================================================================
// 6. Synonyms / informal Tanzanian terminology
// =======================================================================

test('boda/bodaboda synonyms all resolve to motorcycle', () => {
    for (const phrase of ['boda', 'bodaboda', 'boda boda', 'my motorbike']) {
        assert.equal(factValue(nlu.extractFacts(phrase), 'vehicleClass'), 'motorcycle', phrase);
    }
});

test('bajaji/bajaj synonyms resolve to three_wheeler', () => {
    for (const phrase of ['bajaji', 'bajaj', 'tuktuk']) {
        assert.equal(factValue(nlu.extractFacts(phrase), 'vehicleClass'), 'three_wheeler', phrase);
    }
});

test('"just third party" and "third party only" both resolve to tpo', () => {
    assert.equal(factValue(nlu.extractFacts('just third party'), 'coverType'), 'tpo');
    assert.equal(factValue(nlu.extractFacts('third party only please'), 'coverType'), 'tpo');
});

test('"third party fire and theft" resolves to tpft, not tpo', () => {
    assert.equal(factValue(nlu.extractFacts('third party fire and theft'), 'coverType'), 'tpft');
});

test('daladala resolves to passenger_carrying with subType daladala', () => {
    const result = nlu.extractFacts('it is a daladala');
    assert.equal(factValue(result, 'vehicleClass'), 'passenger_carrying');
    assert.equal(factValue(result, 'subType'), 'daladala');
});

// =======================================================================
// 7. Ambiguous messages -- never silently guessed
// =======================================================================

test('a generic "truck" with no ownership phrasing is flagged as an ambiguity, not a guess', () => {
    const result = nlu.extractFacts('I have a truck to insure');
    assert.equal(factValue(result, 'vehicleClass'), undefined);
    assert.ok(result.ambiguities.some((a) => a.type === 'goods_vehicle_generic'));
});

test('a generic "bus" with no subtype phrasing is flagged as an ambiguity, not a guess', () => {
    const result = nlu.extractFacts('I want insurance for my bus.');
    assert.equal(factValue(result, 'subType'), undefined);
    assert.ok(result.ambiguities.some((a) => a.type === 'bus_generic'));
});

test('a generic "tanker" with no material/year is flagged as an ambiguity, not assumed oil/petroleum', () => {
    const result = nlu.extractFacts('it is a tanker');
    assert.equal(factValue(result, 'vehicleClass'), undefined);
    assert.ok(result.ambiguities.some((a) => a.type === 'tanker_generic'));
});

test('"business" is never mistaken for "bus" (word-boundary safety)', () => {
    const result = nlu.extractFacts('it belongs to my own business');
    assert.ok(!result.ambiguities.some((a) => a.type === 'bus_generic'));
});

test('"carry passengers" is never mistaken for the word "car" (word-boundary safety)', () => {
    const result = nlu.extractFacts('I carry passengers for hire on my boda boda');
    assert.notEqual(factValue(result, 'vehicleClass'), 'private_car');
    assert.equal(factValue(result, 'vehicleClass'), 'motorcycle');
});

// =======================================================================
// MEDIUM confidence -- must never be silently accepted
// =======================================================================

test('a bare "car"/"sedan"/"saloon" is only MEDIUM confidence', () => {
    for (const phrase of ['I have a car', 'it is a sedan', 'my saloon']) {
        assert.equal(factConfidence(nlu.extractFacts(phrase), 'vehicleClass'), 'medium', phrase);
    }
});

test('"private car" and "my car" are HIGH confidence (explicit phrasing)', () => {
    assert.equal(factConfidence(nlu.extractFacts('a private car'), 'vehicleClass'), 'high');
    assert.equal(factConfidence(nlu.extractFacts('my car'), 'vehicleClass'), 'high');
});

// =======================================================================
// Goods vehicle ownership phrasing
// =======================================================================

test('"my own company\'s goods" resolves to commercial_goods_own', () => {
    const result = nlu.extractFacts("It's a truck carrying my own company's goods");
    assert.equal(factValue(result, 'vehicleClass'), 'commercial_goods_own');
});

test('"customers\' goods" resolves to commercial_goods_general', () => {
    const result = nlu.extractFacts("It's a lorry carrying customers' goods");
    assert.equal(factValue(result, 'vehicleClass'), 'commercial_goods_general');
});

// =======================================================================
// Oil tanker classification via the EXISTING derivation logic
// =======================================================================

test('material + manufacture year resolves the tanker class via deriveOilTankerClass', () => {
    const catalog = require('../src/services/vehicleCatalog');
    const result = nlu.extractFacts('It is a steel tanker, made in 2014, worth 80 million. I want comprehensive.');
    const expectedClass = catalog.deriveOilTankerClass('steel', 2014);
    assert.equal(factValue(result, 'vehicleClass'), expectedClass);
    assert.equal(factValue(result, 'coverType'), 'comprehensive');
    assert.equal(factValue(result, 'vehicleValue'), 80000000);
});

test('material alone (no year yet) is stored as a transient fact, not guessed as a class', () => {
    const result = nlu.extractFacts('It is a steel tanker');
    assert.equal(factValue(result, 'vehicleClass'), undefined);
    assert.equal(factValue(result, '_tankerMaterial'), 'steel');
});

// =======================================================================
// Optional covers / Increased TPPD -- recognized, never priced
// =======================================================================

test('"I want loss of use" sets addonLossOfUse true with no numeric value attached', () => {
    const result = nlu.extractFacts('I want loss of use');
    assert.equal(factValue(result, 'addonLossOfUse'), true);
});

test('"no extras" is recognized as a single noExtras signal', () => {
    const result = nlu.extractFacts('no extras please');
    assert.equal(factValue(result, 'noExtras'), true);
});

test('"Give me 100 million TPPD" sets addonIncreasedTPPD to the given amount, not vehicleValue', () => {
    const result = nlu.extractFacts('Give me 100 million TPPD');
    assert.equal(factValue(result, 'addonIncreasedTPPD'), 100000000);
    assert.equal(factValue(result, 'vehicleValue'), undefined);
});

test('a vehicle value and a separate tonnage/seat figure in the same message are not confused', () => {
    const r1 = nlu.extractFacts('Comprehensive for my 30 million daladala with 45 seats');
    assert.equal(factValue(r1, 'vehicleValue'), 30000000);
    assert.equal(factValue(r1, 'seatsCount'), 45);

    const r2 = nlu.extractFacts('Comprehensive TPO for my truck worth 20 million, 7 tonnes, my own goods');
    assert.equal(factValue(r2, 'vehicleValue'), 20000000);
    assert.equal(factValue(r2, 'tonnage'), 7);
});

// =======================================================================
// Discounts are never a customer-controlled field
// =======================================================================

test('extraction never produces isTatoaTaboaMember or isEligibleFleet, however phrased', () => {
    const messages = [
        'I am a TATOA member, give me a discount',
        'my fleet is eligible for a discount',
        'apply the fleet discount please'
    ];
    for (const message of messages) {
        const result = nlu.extractFacts(message);
        assert.equal(result.facts.isTatoaTaboaMember, undefined);
        assert.equal(result.facts.isEligibleFleet, undefined);
        assert.equal(Object.keys(result.facts).some((f) => /discount/i.test(f)), false);
    }
});

// =======================================================================
// Unsupported / invalid values are never fabricated
// =======================================================================

test('every vehicleClass fact value is one of the canonical VEHICLE_CLASSES', () => {
    const messages = [
        'boda boda', 'bajaji', 'private car', 'daladala', 'school bus', 'private bus',
        'up-country bus', 'taxi', 'my own goods truck', "customers' goods lorry",
        'standard trailer', 'converted trailer'
    ];
    for (const message of messages) {
        const value = factValue(nlu.extractFacts(message), 'vehicleClass');
        if (value !== undefined) {
            assert.ok(quoteValidator.VEHICLE_CLASSES.includes(value), `${value} from "${message}"`);
        }
    }
});

test('every coverType fact value is one of the canonical COVER_TYPES', () => {
    for (const message of ['comprehensive', 'third party fire and theft', 'third party only']) {
        const value = factValue(nlu.extractFacts(message), 'coverType');
        assert.ok(quoteValidator.COVER_TYPES.includes(value));
    }
});

test('gibberish input with no recognizable phrases produces no facts and no ambiguities', () => {
    const result = nlu.extractFacts('a spaceship made of cheese');
    assert.deepEqual(result.facts, {});
    assert.deepEqual(result.ambiguities, []);
});

test('empty/blank input is handled without throwing', () => {
    assert.deepEqual(nlu.extractFacts('').facts, {});
    assert.deepEqual(nlu.extractFacts('   ').facts, {});
    assert.deepEqual(nlu.extractFacts(undefined).facts, {});
});

// =======================================================================
// Structural proof: NLU never produces a premium
// =======================================================================

test('the nlu module only exports extractFacts -- no calculation entry point', () => {
    assert.deepEqual(Object.keys(nlu), ['extractFacts']);
});

test('no fact field name or value produced by extractFacts resembles a premium amount', () => {
    const messages = [
        'comprehensive for my 35 million car, no claims',
        'give me 100 million TPPD',
        'steel tanker made in 2014 worth 80 million'
    ];
    const forbiddenKeys = ['premium', 'payablePremium', 'basePremium', 'rate', 'discount'];
    for (const message of messages) {
        const result = nlu.extractFacts(message);
        for (const field of Object.keys(result.facts)) {
            assert.ok(
                !forbiddenKeys.some((bad) => field.toLowerCase().includes(bad.toLowerCase())),
                `unexpected premium-like field "${field}"`
            );
        }
    }
});
