const test = require('node:test');
const assert = require('node:assert/strict');
const conversationService = require('../src/services/conversationService');
const sessionStore = require('../src/services/sessionStore');
const quoteService = require('../src/services/quoteService');

const { handleIncomingMessage, WELCOME_MESSAGE, CALCULATION_ERROR_MESSAGE } = conversationService;
const { SESSION_STATES } = sessionStore;

let phoneCounter = 0;
function freshPhone() {
    phoneCounter += 1;
    return `2557000${String(phoneCounter).padStart(4, '0')}`;
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

// Canned mock result used whenever a test only cares about the structured
// input reaching quoteService, not the premium figures.
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

/** Answers "No" to the optional-covers gate, driving straight to calculation. */
function declineAllAddons(phone) {
    return send(phone, '2');
}

// =======================================================================
// 1 & 2. Each customer-facing category maps to the correct internal class
// =======================================================================

test('category 1 (Private car) maps to private_car and goes straight to cover', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'private_car');
    assert.equal(getSession(phone).state, SESSION_STATES.COVER_TYPE);
});

test('category 2 (Motorcycle) maps to motorcycle', () => {
    const phone = freshPhone();
    send(phone, 'hi', '2');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'motorcycle');
});

test('category 3 (Three-wheeler) maps to three_wheeler', () => {
    const phone = freshPhone();
    send(phone, 'hi', '3');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'three_wheeler');
});

test('category 4 (Goods vehicle) asks ownership before resolving a class', () => {
    const phone = freshPhone();
    send(phone, 'hi', '4');
    assert.equal(getSession(phone).state, SESSION_STATES.GOODS_OWNERSHIP);
    assert.equal(getSession(phone).quoteData.vehicleClass, undefined);
});

test('category 5 (Passenger vehicle) asks subtype before resolving a class', () => {
    const phone = freshPhone();
    send(phone, 'hi', '5');
    assert.equal(getSession(phone).state, SESSION_STATES.PASSENGER_SUBTYPE);
});

test('category 6 (Trailer) asks trailer type before resolving a class', () => {
    const phone = freshPhone();
    send(phone, 'hi', '6');
    assert.equal(getSession(phone).state, SESSION_STATES.TRAILER_TYPE);
});

test('category 7 (Oil tanker) asks the tanker confirmation question first', () => {
    const phone = freshPhone();
    send(phone, 'hi', '7');
    assert.equal(getSession(phone).state, SESSION_STATES.OIL_TANKER_CONFIRM);
});

test('category 8 (Special vehicle) asks for a description first', () => {
    const phone = freshPhone();
    send(phone, 'hi', '8');
    assert.equal(getSession(phone).state, SESSION_STATES.SPECIAL_DESCRIPTION);
});

test('invalid category selection re-prompts without advancing', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', 'a spaceship');
    assert.match(reply, /didn't recognise that selection/i);
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_CATEGORY);
});

// =======================================================================
// 8. Goods vehicle own/general mapping
// =======================================================================

test('goods ownership option 1 maps to commercial_goods_own', () => {
    const phone = freshPhone();
    send(phone, 'hi', '4', '1');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'commercial_goods_own');
});

test('goods ownership option 2 maps to commercial_goods_general', () => {
    const phone = freshPhone();
    send(phone, 'hi', '4', '2');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'commercial_goods_general');
});

test('invalid goods ownership response re-prompts without advancing', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '4', 'not sure');
    assert.match(reply, /Please reply with:/);
    assert.equal(getSession(phone).state, SESSION_STATES.GOODS_OWNERSHIP);
});

// =======================================================================
// 6. Passenger subtype mapping
// =======================================================================

const PASSENGER_SUBTYPE_CASES = [
    ['1', 'taxi_tour'],
    ['2', 'daladala'],
    ['3', 'bus_up_country'],
    ['4', 'bus_private'],
    ['5', 'bus_school']
];

for (const [option, expectedSubType] of PASSENGER_SUBTYPE_CASES) {
    test(`passenger subtype option ${option} maps to subType "${expectedSubType}"`, () => {
        const phone = freshPhone();
        send(phone, 'hi', '5', option);
        assert.equal(getSession(phone).quoteData.vehicleClass, 'passenger_carrying');
        assert.equal(getSession(phone).quoteData.subType, expectedSubType);
    });
}

// =======================================================================
// 9. Trailer standard/conversion mapping
// =======================================================================

test('trailer type option 1 maps to trailer_standard', () => {
    const phone = freshPhone();
    send(phone, 'hi', '6', '1');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'trailer_standard');
});

test('trailer type option 2 maps to trailer_conversion', () => {
    const phone = freshPhone();
    send(phone, 'hi', '6', '2');
    assert.equal(getSession(phone).quoteData.vehicleClass, 'trailer_conversion');
});

// =======================================================================
// 10. Oil tanker material/age derivation
// =======================================================================

test('oil tanker: steel, <=10 years old -> oil_tanker_steel', () => {
    const phone = freshPhone();
    const currentYear = new Date().getFullYear();
    send(phone, 'hi', '7', 'yes', '1', String(currentYear - 3));
    assert.equal(getSession(phone).quoteData.vehicleClass, 'oil_tanker_steel');
});

test('oil tanker: aluminium, <=10 years old -> oil_tanker_aluminum', () => {
    const phone = freshPhone();
    const currentYear = new Date().getFullYear();
    send(phone, 'hi', '7', 'yes', '2', String(currentYear - 3));
    assert.equal(getSession(phone).quoteData.vehicleClass, 'oil_tanker_aluminum');
});

test('oil tanker: any material, >10 years old -> oil_tanker_over_10y', () => {
    const phone = freshPhone();
    const currentYear = new Date().getFullYear();
    send(phone, 'hi', '7', 'yes', '1', String(currentYear - 15));
    assert.equal(getSession(phone).quoteData.vehicleClass, 'oil_tanker_over_10y');

    const phone2 = freshPhone();
    send(phone2, 'hi', '7', 'yes', '2', String(currentYear - 15));
    assert.equal(getSession(phone2).quoteData.vehicleClass, 'oil_tanker_over_10y');
});

test('oil tanker: answering "no" to the confirmation returns to the vehicle menu, not manual review', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '7', 'no');
    assert.match(reply, /vehicle would you like to insure/i);
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_CATEGORY);
});

test('invalid oil tanker year is rejected and re-prompted', () => {
    const phone = freshPhone();
    send(phone, 'hi', '7', 'yes', '1');
    const reply = send(phone, 'not a year');
    assert.match(reply, /4-digit year/i);
    assert.equal(getSession(phone).state, SESSION_STATES.OIL_TANKER_YEAR);
});

// =======================================================================
// 3. Cover-type menu is filtered per class; unsupported combos blocked
// =======================================================================

test('classes with a tpft branch offer 3 cover options', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '1'); // private_car
    assert.match(reply, /1\. Comprehensive/);
    assert.match(reply, /2\. Third Party Fire & Theft/);
    assert.match(reply, /3\. Third Party Only/);
});

test('trailer (no tpft branch) offers only 2 cover options', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '6', '1');
    assert.match(reply, /1\. Comprehensive/);
    assert.match(reply, /2\. Third Party Only/);
    assert.doesNotMatch(reply, /Fire & Theft/);
});

test('unsupported combination (trailer + TPFT) is blocked with the specific message', () => {
    const phone = freshPhone();
    send(phone, 'hi', '6', '1');
    const reply = send(phone, 'tpft');
    assert.match(reply, /not currently available for this vehicle type/i);
    assert.equal(getSession(phone).state, SESSION_STATES.COVER_TYPE);
});

test('unsupported combination (passenger vehicle + TPFT) is blocked', () => {
    const phone = freshPhone();
    send(phone, 'hi', '5', '2');
    const reply = send(phone, 'tpft');
    assert.match(reply, /not currently available for this vehicle type/i);
});

test('unsupported combination (special vehicle + TPFT) is blocked', () => {
    const phone = freshPhone();
    send(phone, 'hi', '8', 'crane');
    const reply = send(phone, 'tpft');
    assert.match(reply, /not currently available for this vehicle type/i);
});

test('a genuinely unrecognized cover reply gets the generic re-prompt, not the "unsupported" message', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1');
    const reply = send(phone, 'banana');
    assert.match(reply, /didn't recognise that selection/i);
    assert.doesNotMatch(reply, /not currently available/i);
});

// =======================================================================
// 4. Conditional claims questions
// =======================================================================

test('claims question is asked for private_car comprehensive', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '1', '1', '25000000');
    assert.match(reply, /previous claim record|any insurance claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.CLAIMS);
});

test('claims question is skipped for private_car TPO', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '1', '3', '25000000');
    assert.doesNotMatch(reply, /claim record/i);
    assert.notEqual(getSession(phone).state, SESSION_STATES.CLAIMS);
});

test('claims question is skipped for oil tanker comprehensive (flat rate, not read by the engine)', () => {
    const currentYear = new Date().getFullYear();
    const phone = freshPhone();
    const reply = send(phone, 'hi', '7', 'yes', '1', String(currentYear - 2), '1');
    assert.doesNotMatch(reply, /claim record/i);
    assert.notEqual(getSession(phone).state, SESSION_STATES.CLAIMS);
});

test('claims question is skipped for special vehicle comprehensive (flat rate)', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '8', 'a mobile crane', '1');
    assert.doesNotMatch(reply, /claim record/i);
    assert.notEqual(getSession(phone).state, SESSION_STATES.CLAIMS);
});

test('claims question is skipped for daladala comprehensive (flat formula)', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '5', '2', '1', '25000000', '30');
    assert.doesNotMatch(reply, /claim record/i);
    assert.notEqual(getSession(phone).state, SESSION_STATES.CLAIMS);
});

test('claims question IS asked for taxi/tour comprehensive (the one passenger subtype that reads it)', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '5', '1', '1', '25000000', '4');
    assert.match(reply, /claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.CLAIMS);
});

// =======================================================================
// 5. Passenger-for-hire question
// =======================================================================

test('for-hire question is asked for motorcycle', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '2', '1', '3000000');
    assert.match(reply, /carry passengers for hire/i);
    assert.equal(getSession(phone).state, SESSION_STATES.PASSENGER_FOR_HIRE);
});

test('for-hire question is asked for three-wheeler', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '3', '1', '3000000');
    assert.match(reply, /carry passengers for hire/i);
});

test('for-hire question is NOT asked for private car', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '1', '1', '25000000');
    assert.doesNotMatch(reply, /carry passengers for hire/i);
});

test('invalid for-hire response re-prompts without advancing', () => {
    const phone = freshPhone();
    send(phone, 'hi', '2', '1', '3000000');
    const reply = send(phone, 'dunno');
    assert.match(reply, /Please reply with:/);
    assert.equal(getSession(phone).state, SESSION_STATES.PASSENGER_FOR_HIRE);
});

// =======================================================================
// 7. Seats collection
// =======================================================================

test('seats question is asked for passenger vehicles and stores seatsCount', () => {
    const phone = freshPhone();
    send(phone, 'hi', '5', '2', '2', '25000000');
    send(phone, '32');
    assert.equal(getSession(phone).quoteData.seatsCount, 32);
});

test('invalid seat count is rejected', () => {
    const phone = freshPhone();
    send(phone, 'hi', '5', '2', '2', '25000000');
    const reply = send(phone, 'lots');
    assert.match(reply, /number of passenger seats/i);
    assert.equal(getSession(phone).state, SESSION_STATES.SEATS_COUNT);
});

// =======================================================================
// Tonnage (goods vehicles, TPO only)
// =======================================================================

test('tonnage question is asked only for goods vehicles on TPO', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '4', '1', '3', '20000000');
    assert.match(reply, /carrying capacity in tonnes/i);
    assert.equal(getSession(phone).state, SESSION_STATES.TONNAGE);
});

test('tonnage question is NOT asked for goods vehicles on comprehensive', () => {
    const phone = freshPhone();
    const reply = send(phone, 'hi', '4', '1', '1', '20000000', 'no');
    assert.doesNotMatch(reply, /carrying capacity/i);
});

test('invalid tonnage is rejected', () => {
    const phone = freshPhone();
    send(phone, 'hi', '4', '1', '3', '20000000');
    const reply = send(phone, 'heavy');
    assert.match(reply, /carrying capacity in tonnes/i);
    assert.equal(getSession(phone).state, SESSION_STATES.TONNAGE);
});

// =======================================================================
// 11 & 12. Optional-cover branching and Increased TPPD amount collection
// =======================================================================

test('optional covers gate "No" skips straight to confirmation with all add-ons cleared', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000', 'no');
    const reply = send(phone, '2'); // gate = No
    assert.match(reply, /confirm your quotation details/i);
    const { quoteData } = getSession(phone);
    assert.equal(quoteData.addonCarTracker, false);
    assert.equal(quoteData.addonIncreasedTPPD, 0);
});

test('only applicable add-ons are queued for a TPO quote (tracker + TPPD only)', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000'); // private car, TPO -> straight past claims
    send(phone, 'yes'); // optional covers gate = yes
    assert.deepEqual(getSession(phone).quoteData._addonQueue, ['addonCarTracker', 'addonIncreasedTPPD']);
});

test('all five add-ons are queued for a private car comprehensive quote', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000', 'no', 'yes');
    assert.deepEqual(getSession(phone).quoteData._addonQueue, [
        'addonCarTracker',
        'addonLossOfUse',
        'addonExcessBuyBack',
        'addonGeographical',
        'addonIncreasedTPPD'
    ]);
});

test('loss of use is never queued for a non-private-car comprehensive quote', () => {
    const phone = freshPhone();
    send(phone, 'hi', '2', '1', '3000000', 'no', 'no', 'yes'); // motorcycle comprehensive
    assert.ok(!getSession(phone).quoteData._addonQueue.includes('addonLossOfUse'));
});

test('TPPD gate "No" produces addonIncreasedTPPD 0 and proceeds to confirmation', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'yes'); // TPO, gate yes -> tracker, tppd only
    send(phone, 'no'); // tracker no
    const reply = send(phone, 'no'); // tppd gate no
    assert.match(reply, /confirm your quotation details/i);
    assert.equal(getSession(phone).quoteData.addonIncreasedTPPD, 0);
});

test('TPPD gate "Yes" proceeds to amount collection, not confirmation', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'yes', 'no'); // tracker no -> tppd gate
    const reply = send(phone, 'yes');
    assert.match(reply, /additional TPPD limit/i);
    assert.equal(getSession(phone).state, SESSION_STATES.ADDON_TPPD_AMOUNT);
});

test('a valid TPPD amount is passed unchanged into quoteService (not a percentage, not a premium)', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'yes', 'no', 'yes', '50,000,000');
    send(phone, '1'); // confirm and calculate

    assert.equal(capturedInput.addonIncreasedTPPD, 50000000);
});

test('an invalid TPPD amount is rejected and re-prompted without advancing', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'yes', 'no', 'yes');
    const reply = send(phone, 'zero');
    assert.match(reply, /positive amount in TZS|Tanzanian Shillings/i);
    assert.equal(getSession(phone).state, SESSION_STATES.ADDON_TPPD_AMOUNT);
});

// =======================================================================
// 13. Discounts are never asked about
// =======================================================================

test('no message anywhere in the flow mentions discount, TATOA, TABOA, or fleet eligibility', () => {
    const phone = freshPhone();
    const allReplies = [];
    allReplies.push(send(phone, 'hello'));
    allReplies.push(send(phone, '1'));
    allReplies.push(send(phone, '1'));
    allReplies.push(send(phone, '25000000'));
    allReplies.push(send(phone, 'no'));
    allReplies.push(send(phone, 'yes'));
    allReplies.push(send(phone, 'yes')); // tracker
    allReplies.push(send(phone, 'no'));
    allReplies.push(send(phone, 'no'));
    allReplies.push(send(phone, 'no'));
    allReplies.push(send(phone, 'no'));
    allReplies.push(send(phone, '1')); // confirm

    for (const reply of allReplies) {
        assert.doesNotMatch(reply, /discount/i);
        assert.doesNotMatch(reply, /tatoa/i);
        assert.doesNotMatch(reply, /taboa/i);
        assert.doesNotMatch(reply, /fleet/i);
    }
});

test('isTatoaTaboaMember and isEligibleFleet are always false regardless of path', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    // claims, gate, tracker, lossofuse, excessbuyback, geo, tppd-gate = 7 yes/no answers, then the amount.
    send(phone, 'hi', '1', '1', '25000000', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', '10,000,000');
    send(phone, '1');

    assert.equal(capturedInput.isTatoaTaboaMember, false);
    assert.equal(capturedInput.isEligibleFleet, false);
});

// =======================================================================
// 15. Invalid numeric inputs (vehicle value)
// =======================================================================

test('invalid vehicle value is rejected and re-prompted', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1');
    for (const bad of ['zero', '0', '-25000000', 'not a number', 'NaN']) {
        const reply = send(phone, bad);
        assert.match(reply, /Tanzanian Shillings/i);
        assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_VALUE);
    }
});

test('a comma/TZS-formatted vehicle value is normalized correctly', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', 'TZS 25,000,000');
    assert.equal(getSession(phone).quoteData.vehicleValue, 25000000);
});

// =======================================================================
// 16. Back navigation
// =======================================================================

test('"back" returns to the previous question and re-displays its prompt', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1'); // category -> cover prompt
    const reply = send(phone, 'back'); // -> category prompt again
    assert.match(reply, /vehicle would you like to insure/i);
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_CATEGORY);
});

test('"back" with no history yet returns a friendly message and does not crash', () => {
    const phone = freshPhone();
    send(phone, 'hi');
    const reply = send(phone, 'back');
    assert.match(reply, /nothing to go back to/i);
});

test('going back multiple steps restores each prior question in order', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000'); // now at CLAIMS
    assert.equal(getSession(phone).state, SESSION_STATES.CLAIMS);
    send(phone, 'back'); // -> VEHICLE_VALUE prompt again
    assert.equal(getSession(phone).state, SESSION_STATES.VEHICLE_VALUE);
    send(phone, 'back'); // -> COVER_TYPE prompt again
    assert.equal(getSession(phone).state, SESSION_STATES.COVER_TYPE);
});

// =======================================================================
// 17. Restart
// =======================================================================

test('"restart" clears the session and shows the category menu again', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000');
    const reply = send(phone, 'restart');
    assert.equal(reply, WELCOME_MESSAGE);
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.VEHICLE_CATEGORY);
    assert.deepEqual(session.quoteData, {});
    assert.deepEqual(session.history, []);
});

test('restart does not leak data into a fresh quotation attempt', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000'); // vehicleValue = 25,000,000
    send(phone, 'restart');
    send(phone, '2'); // motorcycle this time
    assert.equal(getSession(phone).quoteData.vehicleClass, 'motorcycle');
    assert.equal(getSession(phone).quoteData.vehicleValue, undefined);
});

test('"another quotation" after a completed quote also starts a fully fresh session', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no', '1'); // TPO, decline addons, confirm -> quote
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
    const reply = send(phone, '1');
    assert.equal(reply, WELCOME_MESSAGE);
    assert.deepEqual(getSession(phone).quoteData, {});
});

// =======================================================================
// 18. Stale dependent data removed when an earlier answer changes
// =======================================================================

test('switching cover from comprehensive to TPO after going back clears claims and comprehensive-only add-ons', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000', 'yes'); // comprehensive, claims = yes
    assert.equal(getSession(phone).quoteData.hasClaimRecord, true);

    send(phone, 'back'); // -> back to CLAIMS prompt (the last state before the gate)
    send(phone, 'back'); // -> back to VEHICLE_VALUE prompt
    send(phone, 'back'); // -> back to COVER_TYPE prompt
    assert.equal(getSession(phone).state, SESSION_STATES.COVER_TYPE);

    send(phone, '3'); // switch to TPO
    assert.equal(getSession(phone).quoteData.coverType, 'tpo');
    assert.equal(getSession(phone).quoteData.hasClaimRecord, false);
    assert.equal(getSession(phone).quoteData.addonExcessBuyBack, false);
    assert.equal(getSession(phone).quoteData.addonLossOfUse, false);
    assert.equal(getSession(phone).quoteData.addonGeographical, false);
});

test('"Change details" from the confirmation screen goes back one step, not a full reset', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no'); // TPO, decline addons -> CONFIRMATION
    assert.equal(getSession(phone).state, SESSION_STATES.CONFIRMATION);
    const reply = send(phone, '2'); // Change details
    assert.match(reply, /optional covers/i);
    assert.equal(getSession(phone).state, SESSION_STATES.OPTIONAL_COVERS_GATE);
});

test('"Cancel" from the confirmation screen clears the session', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no');
    const reply = send(phone, '3'); // Cancel
    assert.equal(reply, WELCOME_MESSAGE);
    assert.deepEqual(getSession(phone).quoteData, {});
});

// =======================================================================
// 19. Final confirmation required before calculation
// =======================================================================

test('the customer sees a confirmation summary before any calculation happens', (t) => {
    let called = false;
    t.mock.method(quoteService, 'calculateQuote', () => {
        called = true;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000');
    const reply = send(phone, 'no'); // decline addons -> should land on CONFIRMATION, not calculate yet

    assert.match(reply, /Please confirm your quotation details/);
    assert.equal(called, false);
    assert.equal(getSession(phone).state, SESSION_STATES.CONFIRMATION);
});

test('confirmation summary reflects the structured session data (spot check)', () => {
    const phone = freshPhone();
    // claims=yes, gate=yes, tracker=yes, lossofuse=yes, excessbuyback=no, geo=no
    send(phone, 'hi', '1', '1', '25000000', 'yes', 'yes', 'yes', 'yes', 'no', 'no');
    const summary = send(phone, 'no'); // TPPD gate no -> confirmation
    assert.match(summary, /Vehicle: Private Car/);
    assert.match(summary, /Cover: Comprehensive/);
    assert.match(summary, /Vehicle value: TZS 25,000,000/);
    assert.match(summary, /Claims record: Yes/);
    assert.match(summary, /Tracker: Yes/);
    assert.match(summary, /Loss of Use: Yes/);
    assert.match(summary, /Excess Buy-Back: No/);
});

test('invalid input at the confirmation screen re-shows the summary without calculating', (t) => {
    let called = false;
    t.mock.method(quoteService, 'calculateQuote', () => {
        called = true;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no');
    const reply = send(phone, 'maybe later');
    assert.match(reply, /didn't recognise that option/i);
    assert.equal(called, false);
    assert.equal(getSession(phone).state, SESSION_STATES.CONFIRMATION);
});

// =======================================================================
// 20 & 21. Successful handoff to quoteService, and proof the conversation
// layer never calculates a premium independently.
// =======================================================================

test('confirming sends the exact expected structured quote object to quoteService (private car)', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    send(phone, 'hi', '1', '1', '25000000', 'yes', 'no', 'no', 'no', 'no');
    send(phone, '1'); // confirm

    assert.deepEqual(capturedInput, {
        vehicleClass: 'private_car',
        coverType: 'comprehensive',
        vehicleValue: 25000000,
        hasClaimRecord: true,
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
    });
});

test('confirming a goods vehicle quote sends the correct tonnage and ownership-derived class', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    send(phone, 'hi', '4', '2', '3', '20000000', '7', 'no'); // general goods, TPO, 7 tonnes, no addons
    send(phone, '1');

    assert.equal(capturedInput.vehicleClass, 'commercial_goods_general');
    assert.equal(capturedInput.coverType, 'tpo');
    assert.equal(capturedInput.tonnage, 7);
});

test('confirming a passenger vehicle quote sends the correct subType and seatsCount', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return stubQuoteResult();
    });

    const phone = freshPhone();
    send(phone, 'hi', '5', '2', '1', '25000000', '30', 'no'); // daladala, comprehensive (claims skipped), 30 seats
    send(phone, '1');

    assert.equal(capturedInput.vehicleClass, 'passenger_carrying');
    assert.equal(capturedInput.subType, 'daladala');
    assert.equal(capturedInput.seatsCount, 30);
});

test('the displayed premium is exactly whatever quoteService returns -- proof the conversation layer never calculates independently', (t) => {
    t.mock.method(quoteService, 'calculateQuote', () => ({
        success: true,
        result: {
            summary: {
                calculatedBasePremium: 1,
                totalAddonLoadings: 2,
                totalDiscountsDeducted: 3,
                payablePremiumTZS: 4,
                vatRate: 0.18,
                vatAmount: 5,
                payablePremiumWithVAT: 9999999 // an intentionally implausible, unmistakable stub value
            },
            complianceDetails: { currency: 'TZS', excessMandateRule: 'stub rule', systemLogs: [] }
        }
    }));

    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no');
    const reply = send(phone, '1'); // confirm

    assert.match(reply, /TZS 9,999,999/);
});

test('a real (unmocked) private-car TPO quote reaches quoteService/ratingEngine and matches its actual output exactly', () => {
    const input = {
        vehicleClass: 'private_car',
        coverType: 'tpo',
        vehicleValue: 25000000,
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
    const expected = quoteService.calculateQuote(input).result;

    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no');
    const reply = send(phone, '1');

    assert.match(reply, new RegExp(`Premium: TZS ${expected.summary.payablePremiumWithVAT.toLocaleString('en-US')}`));
});

// =======================================================================
// Calculation errors remain customer-safe
// =======================================================================

test('a calculation error at confirmation returns a customer-safe message and logs server-side', (t) => {
    t.mock.method(quoteService, 'calculateQuote', () => {
        throw new Error('simulated internal failure with a stack trace');
    });
    t.mock.method(console, 'error', () => {});

    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no');
    const reply = send(phone, '1');

    assert.equal(reply, CALCULATION_ERROR_MESSAGE);
    assert.doesNotMatch(reply, /simulated internal failure/);
    assert.doesNotMatch(reply, /Error:/);
    assert.ok(console.error.mock.calls.length > 0);
});

// =======================================================================
// Session isolation (retained from earlier phases)
// =======================================================================

test('two customers have fully independent sessions', () => {
    const phoneA = freshPhone();
    const phoneB = freshPhone();

    send(phoneA, 'hi', '1', '1', '25000000');
    assert.equal(getSession(phoneA).state, SESSION_STATES.CLAIMS);

    const replyB = send(phoneB, 'hello');
    assert.equal(replyB, WELCOME_MESSAGE);
    assert.equal(getSession(phoneB).quoteData.vehicleClass, undefined);

    assert.equal(getSession(phoneA).state, SESSION_STATES.CLAIMS);
    assert.equal(getSession(phoneA).quoteData.vehicleValue, 25000000);
});

// =======================================================================
// Advisor handoff / unrecognized post-quote input (retained behavior)
// =======================================================================

test('replying "2" after a quote returns the advisor handoff message', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no', '1');
    const reply = send(phone, '2');
    assert.match(reply, /representative will assist you|advisor will assist you/i);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});

test('unrecognized input after a quote re-prompts instead of resetting', () => {
    const phone = freshPhone();
    send(phone, 'hi', '1', '3', '25000000', 'no', '1');
    const reply = send(phone, 'what now?');
    assert.match(reply, /didn't recognise that option/i);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});
