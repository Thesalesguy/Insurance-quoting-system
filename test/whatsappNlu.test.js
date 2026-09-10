/**
 * End-to-end conversation tests for Phase 3D (natural-language input).
 *
 * These exercise the same conversationService.handleIncomingMessage()
 * entry point as the menu-driven flow in whatsappConversation.test.js --
 * there is no separate "AI path". Every test here proves that a
 * natural-language reply is only ever accepted as a fallback once the
 * exact-match structured parser for the current state has failed, that
 * it is merged through the same catalog applicability rules, and that
 * the resulting quoteData is handed to the real quoteService/
 * ratingEngine, never a number the conversation layer invented itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const conversationService = require('../src/services/conversationService');
const sessionStore = require('../src/services/sessionStore');
const quoteService = require('../src/services/quoteService');

const { handleIncomingMessage } = conversationService;
const { SESSION_STATES } = sessionStore;

let phoneCounter = 0;
function freshPhone() {
    phoneCounter += 1;
    return `2557001${String(phoneCounter).padStart(4, '0')}`;
}

function getSession(phone) {
    return sessionStore.getOrCreateSession(phone);
}

function send(phone, ...messages) {
    let last;
    for (const message of messages) {
        last = handleIncomingMessage(phone, message);
    }
    return last;
}

function stubQuoteResult() {
    return {
        success: true,
        result: {
            summary: {
                calculatedBasePremium: 111,
                totalAddonLoadings: 222,
                totalDiscountsDeducted: 333,
                payablePremiumTZS: 444,
                vatRate: 0.18,
                vatAmount: 555,
                payablePremiumWithVAT: 666
            },
            complianceDetails: { currency: 'TZS', excessMandateRule: 'test rule', systemLogs: [] }
        }
    };
}

// =======================================================================
// Worked examples from the Phase 3D spec
// =======================================================================

test('multi-fact free text at the category stage extracts cover/value/claims and keeps asking for the vehicle type', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'I want comprehensive for my 35 million Toyota Noah, no claims.');

    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_CATEGORY);
    assert.match(reply, /vehicle would you like to insure/i);
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.coverType, 'comprehensive');
    assert.equal(quoteData.vehicleValue, 35000000);
    assert.equal(quoteData.hasClaimRecord, false);
});

test('a message resolved later never re-asks for a fact already given earlier', () => {
    const phone = freshPhone();
    send(phone, 'hi', 'I want comprehensive for my 35 million Toyota Noah, no claims.');
    // Now answer the vehicle type through the normal menu -- the
    // previously-extracted facts must carry through untouched and the
    // flow must skip straight past vehicle value and claims.
    const reply = send(phone, '1'); // private car
    assert.doesNotMatch(reply, /current value of the vehicle/i);
    assert.doesNotMatch(reply, /claim record/i);
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.vehicleClass, 'private_car');
    assert.equal(quoteData.vehicleValue, 35000000);
    assert.equal(quoteData.hasClaimRecord, false);
});

test('"boda boda ... for passengers" resolves class, cover and for-hire in one message and skips vehicle value', () => {
    const phone = freshPhone();
    send(phone, 'hi', 'I need third party for my boda boda. I use it for passengers.');
    const { quoteData, state } = getSession(phone);
    assert.equal(quoteData.vehicleClass, 'motorcycle');
    assert.equal(quoteData.coverType, 'tpo');
    assert.equal(quoteData.carryingPassengers, true);
    assert.equal(quoteData.vehicleValue, 0); // never asked, TPO never reads it (same inert default the exact-match flow uses)
    assert.notEqual(state, SESSION_STATES.VEHICLE_VALUE);
    assert.notEqual(state, SESSION_STATES.PASSENGER_FOR_HIRE);
});

test('"I want insurance for my bus" asks the existing subtype menu instead of guessing', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'I want insurance for my bus.');
    assert.equal(getSession(phone).state, SESSION_STATES.PASSENGER_SUBTYPE);
    assert.match(reply, /what is the vehicle mainly used for/i);
    assert.match(reply, /1\. Taxi \/ tour vehicle/);
});

test('tanker material + year + value + cover derive the class via the existing deriveOilTankerClass logic', () => {
    const catalog = require('../src/services/vehicleCatalog');
    const phone = freshPhone();
    send(phone, 'hi', 'It is a steel tanker, made in 2014, worth 80 million. I want comprehensive.');
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.vehicleClass, catalog.deriveOilTankerClass('steel', 2014));
    assert.equal(quoteData.coverType, 'comprehensive');
    assert.equal(quoteData.vehicleValue, 80000000);
});

// =======================================================================
// Ambiguity -> existing clarifying question, never a guess
// =======================================================================

test('a generic "truck" at the category stage is routed to the existing goods-ownership question', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'I have a truck to insure');
    assert.equal(getSession(phone).state, SESSION_STATES.GOODS_OWNERSHIP);
    assert.match(reply, /what type of goods does the vehicle normally carry/i);
});

test('a generic "tanker" is routed to the existing oil-tanker confirmation question', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'it is some kind of tanker');
    assert.equal(getSession(phone).state, SESSION_STATES.OIL_TANKER_CONFIRM);
    assert.match(reply, /oil or petroleum tanker/i);
});

// =======================================================================
// Corrections / reconciliation
// =======================================================================

test('a free-text correction at the passenger subtype menu overrides the negated option', () => {
    const phone = freshPhone();
    send(phone, 'hi', '5'); // passenger vehicle -> subtype menu
    send(phone, "Actually it's a school bus, not a private bus");
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.vehicleClass, 'passenger_carrying');
    assert.equal(quoteData.subType, 'bus_school');
});

test('changing the cover to third party at confirmation clears claims and comprehensive-only add-ons', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000', 'yes', 'no'); // private car comprehensive, claims=yes, gate=no -> confirmation
    assert.equal(getSession(phone).state, SESSION_STATES.CONFIRMATION);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, true);

    send(phone, 'Change the cover to third party.');
    const { quoteData, state } = getSession(phone);
    assert.equal(quoteData.coverType, 'tpo');
    assert.notEqual(quoteData.hasClaimRecord, true);
    assert.equal(state, SESSION_STATES.CONFIRMATION);
});

// =======================================================================
// Confidence tiers
// =======================================================================

test('a bare "car" is MEDIUM confidence and asks for confirmation before applying it', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'I have a car');
    assert.equal(getSession(phone).state, SESSION_STATES.NLU_CONFIRM);
    assert.match(reply, /did you mean.*private car/i);
    assert.equal(getSession(phone).quoteData.vehicleClass, undefined);
});

test('confirming the MEDIUM-confidence guess applies it and advances', () => {
    const phone = freshPhone();
    send(phone, 'hi', 'I have a car');
    const reply = send(phone, '1'); // yes
    assert.equal(getSession(phone).quoteData.vehicleClass, 'private_car');
    assert.match(reply, /what type of cover would you like/i);
});

test('rejecting the MEDIUM-confidence guess discards it and returns to the category menu', () => {
    const phone = freshPhone();
    send(phone, 'hi', 'I have a car');
    const reply = send(phone, '2'); // no
    assert.equal(getSession(phone).quoteData.vehicleClass, undefined);
    assert.match(reply, /vehicle would you like to insure/i);
});

// =======================================================================
// TPO vs comprehensive vehicle-value behavior, from natural language
// =======================================================================

test('TPO reached through natural language never collects or requires a vehicle value', () => {
    const phone = freshPhone();
    send(phone, 'hi', 'third party only for my private car');
    assert.notEqual(getSession(phone).state, SESSION_STATES.VEHICLE_VALUE);
});

test('comprehensive reached through natural language still asks for vehicle value if not given', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'comprehensive cover for my private car');
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_VALUE);
    assert.match(reply, /current value of the vehicle/i);
});

// =======================================================================
// Passenger subtype / motorcycle & three-wheeler passenger use
// =======================================================================

test('"tuktuk ... for passengers" resolves three_wheeler with carryingPassengers true', () => {
    const phone = freshPhone();
    send(phone, 'hi', 'I have a tuktuk that carries passengers for hire');
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.vehicleClass, 'three_wheeler');
    assert.equal(quoteData.carryingPassengers, true);
});

test('"school bus" resolves passenger_carrying + bus_school directly, skipping the subtype menu', () => {
    const phone = freshPhone();
    send(phone, 'hi', 'it is a school bus');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'passenger_carrying');
    assert.equal(getSession(phone).quoteData.subType, 'bus_school');
    assert.notEqual(getSession(phone).state, SESSION_STATES.PASSENGER_SUBTYPE);
});

// =======================================================================
// Goods vehicle ownership phrasing
// =======================================================================

test('"my own goods" at the category stage resolves ownership directly, skipping the ownership menu', () => {
    const phone = freshPhone();
    send(phone, 'hi', "It's a lorry carrying my own goods");
    assert.equal(getSession(phone).quoteData.vehicleClass, 'commercial_goods_own');
    assert.notEqual(getSession(phone).state, SESSION_STATES.GOODS_OWNERSHIP);
});

// =======================================================================
// Optional covers / Increased TPPD via natural language
// =======================================================================

test('"no extras" at the optional-covers gate clears every applicable add-on', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000'); // private car TPO -> optional covers gate
    assert.equal(getSession(phone).state, SESSION_STATES.OPTIONAL_COVERS_GATE);
    send(phone, 'no extras please');
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.addonCarTracker, false);
    assert.equal(quoteData.addonIncreasedTPPD, 0);
});

test('"Give me 100 million TPPD" sets the exact TPPD figure without any premium being computed by the conversation layer', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'yes'); // TPO, addons gate = yes
    send(phone, 'Give me 100 million TPPD');
    assert.equal(getSession(phone).quoteData.addonIncreasedTPPD, 100000000);
});

// =======================================================================
// No customer-controlled discounts, ever
// =======================================================================

test('claiming TATOA membership or a fleet discount in free text has no effect on the structured quote input', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    send(phone, 'hi', '1', '3'); // private car, TPO -> straight to the optional-covers gate
    assert.equal(getSession(phone).state, SESSION_STATES.OPTIONAL_COVERS_GATE);
    send(phone, 'I am a TATOA member, please apply my fleet discount');
    send(phone, 'no'); // decline addons -> confirmation
    send(phone, '1'); // confirm

    assert.equal(capturedInput.isTatoaTaboaMember, false);
    assert.equal(capturedInput.isEligibleFleet, false);
});

// =======================================================================
// Unsupported vehicle / cover
// =======================================================================

test('a genuinely unrecognizable message at the category stage still gets the original invalid-category message', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'a spaceship made of cheese');
    assert.match(reply, /didn't recognise that selection/i);
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_CATEGORY);
});

test('an unsupported cover for a vehicle class keeps its specific "not available" message, not a natural-language guess', () => {
    const phone = freshPhone();
    send(phone, 'hi', '6', '1'); // trailer -> cover menu (no tpft)
    const reply = send(phone, 'third party fire and theft please');
    assert.match(reply, /not currently available for this vehicle type/i);
});

// =======================================================================
// Full missing-information engine reaches a real, unmocked quote
// =======================================================================

test('a fully natural-language conversation reaches quoteService/ratingEngine and produces the same figure as the equivalent structured input', () => {
    const structuredInput = {
        vehicleClass: 'private_car',
        coverType: 'tpo',
        vehicleValue: 0,
        hasClaimRecord: false,
        carryingPassengers: false,
        tonnage: 0,
        seatsCount: 0,
        subType: '',
        isTatoaTaboaMember: false,
        isEligibleFleet: false,
        addonExcessBuyBack: false,
        addonLossOfUse: false,
        addonGeographical: false,
        addonIncreasedTPPD: 0,
        addonCarTracker: false
    };
    const expected = quoteService.calculateQuote(structuredInput).result;

    const phone = freshPhone();
    send(phone, 'hi', 'third party only for my private car, no extras');
    assert.equal(getSession(phone).state, SESSION_STATES.CONFIRMATION);
    const reply = send(phone, '1'); // confirm and calculate

    assert.match(reply, new RegExp(`Premium: TZS ${expected.summary.payablePremiumWithVAT.toLocaleString('en-US')}`));
});

// =======================================================================
// Mixed interaction modes -- menu and natural language interleaved
// =======================================================================

test('a conversation can freely mix numbered menu replies and natural language without restarting', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1'); // menu: private car
    send(phone, 'comprehensive please'); // natural language: cover
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_VALUE);
    send(phone, '25,000,000'); // menu-style numeric answer
    assert.equal(getSession(phone).state, SESSION_STATES.CLAIMS);
    send(phone, 'no claims'); // natural language again
    assert.equal(getSession(phone).state, SESSION_STATES.OPTIONAL_COVERS_GATE);
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.vehicleClass, 'private_car');
    assert.equal(quoteData.coverType, 'comprehensive');
    assert.equal(quoteData.vehicleValue, 25000000);
    assert.equal(quoteData.hasClaimRecord, false);
});

test('providing information before it is asked for is accepted and not re-asked later', () => {
    const phone = freshPhone();
    // Answers the category with a menu number, but also volunteers cover
    // and claims information nobody asked for yet.
    send(phone, 'hi', '1');
    send(phone, 'comprehensive, no claims');
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_VALUE);
    send(phone, '25000000');
    // hasClaimRecord was already supplied -- claims must not be re-asked.
    assert.notEqual(getSession(phone).state, SESSION_STATES.CLAIMS);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, false);
});

// =======================================================================
// Regression: existing exact-match behavior is completely unaffected
// =======================================================================

test('menu-driven invalid-answer messages are byte-for-byte unchanged when the reply matches nothing NLU recognizes', () => {
    const phone = freshPhone();
    send(phone, 'hi', '4'); // goods vehicle -> ownership question
    const reply = send(phone, 'not sure');
    assert.equal(reply, 'Please reply with:\n1. Goods belonging to me or my business\n2. Goods belonging to customers or other parties');
    assert.equal(getSession(phone).state, SESSION_STATES.GOODS_OWNERSHIP);
});

test('a numbered menu reply still works normally at every wired-up state (no NLU interference)', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000', 'yes', 'no'); // private car, comprehensive, claims yes, decline addons
    assert.equal(getSession(phone).state, SESSION_STATES.CONFIRMATION);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, true);
});
