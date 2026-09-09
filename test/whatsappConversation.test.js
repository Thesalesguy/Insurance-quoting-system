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
    return `2557000000${phoneCounter}`;
}

function getSession(phone) {
    return sessionStore.getOrCreateSession(phone);
}

const BASE_QUOTE_INPUT = {
    vehicleClass: 'private_car',
    carryingPassengers: false,
    tonnage: 0,
    seatsCount: 0,
    isTatoaTaboaMember: false,
    isEligibleFleet: false
};

/** Answers "No" (2) to all five add-on questions in order, triggering calculation on the last one. */
function answerAllAddonsNo(phone) {
    handleIncomingMessage(phone, '2'); // tracker
    handleIncomingMessage(phone, '2'); // loss of use
    handleIncomingMessage(phone, '2'); // excess buy-back
    handleIncomingMessage(phone, '2'); // geographical
    return handleIncomingMessage(phone, '2'); // tppd gate -> calculates, returns the quote
}

// ---------------------------------------------------------------------
// Phase 1 tests: unaffected by Stage 2 (cover selection, vehicle value
// parsing/validation, invalid-cover handling, session isolation up to
// PRIVATE_CAR_CLAIMS) — kept verbatim.
// ---------------------------------------------------------------------

test('new user receives the welcome message and cover selection prompt', () => {
    const phone = freshPhone();
    const reply = handleIncomingMessage(phone, 'hello');
    assert.equal(reply, WELCOME_MESSAGE);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_COVER);
});

test('comprehensive cover selection is stored and advances to vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'hi');
    const reply = handleIncomingMessage(phone, '1');
    assert.match(reply, /current value of the vehicle/i);
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_VALUE);
    assert.equal(session.quoteData.coverType, 'comprehensive');
});

test('tpft cover selection is stored and advances to vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '2');
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_VALUE);
    assert.equal(session.quoteData.coverType, 'tpft');
});

test('tpo cover selection is stored and advances to vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, 'tpo');
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_VALUE);
    assert.equal(session.quoteData.coverType, 'tpo');
});

test('invalid cover selection re-prompts and does not advance state', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    const reply = handleIncomingMessage(phone, 'banana');
    assert.match(reply, /didn't recognise that selection/i);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_COVER);
});

test('plain numeric vehicle value is normalized', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25000000');
    assert.equal(getSession(phone).quoteData.vehicleValue, 25000000);
});

test('comma-formatted vehicle value is normalized', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25,000,000');
    assert.equal(getSession(phone).quoteData.vehicleValue, 25000000);
});

test('TZS-prefixed vehicle value is normalized', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, 'TZS 25,000,000');
    assert.equal(getSession(phone).quoteData.vehicleValue, 25000000);

    const phone2 = freshPhone();
    handleIncomingMessage(phone2, 'start');
    handleIncomingMessage(phone2, '1');
    handleIncomingMessage(phone2, 'TZS 25 000 000');
    assert.equal(getSession(phone2).quoteData.vehicleValue, 25000000);
});

test('invalid vehicle values are rejected and state does not advance', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');

    for (const badValue of ['zero', '0', '-25000000', 'not a number', 'NaN', 'Infinity']) {
        const reply = handleIncomingMessage(phone, badValue);
        assert.match(reply, /positive amount in TZS/i);
        assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_VALUE);
    }
});

test('comprehensive cover asks for claims history after a valid vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    const reply = handleIncomingMessage(phone, '25000000');
    assert.match(reply, /previous claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_CLAIMS);
});

test('invalid claims response re-prompts and does not advance state', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, 'maybe');
    assert.match(reply, /Please reply with:\s*\n1\. Yes\s*\n2\. No/);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_CLAIMS);
});

test('two customers have fully independent sessions', () => {
    const phoneA = freshPhone();
    const phoneB = freshPhone();

    handleIncomingMessage(phoneA, 'start');
    handleIncomingMessage(phoneA, '1'); // comprehensive
    handleIncomingMessage(phoneA, '25000000');
    assert.equal(getSession(phoneA).state, SESSION_STATES.PRIVATE_CAR_CLAIMS);

    const replyB = handleIncomingMessage(phoneB, 'hello');
    assert.equal(replyB, WELCOME_MESSAGE);
    assert.equal(getSession(phoneB).state, SESSION_STATES.PRIVATE_CAR_COVER);
    assert.equal(getSession(phoneB).quoteData.coverType, undefined);

    // Customer A's in-progress data must be untouched by B's activity.
    assert.equal(getSession(phoneA).state, SESSION_STATES.PRIVATE_CAR_CLAIMS);
    assert.equal(getSession(phoneA).quoteData.coverType, 'comprehensive');
    assert.equal(getSession(phoneA).quoteData.vehicleValue, 25000000);
});

// ---------------------------------------------------------------------
// Phase 1 tests updated for Stage 2: the flow no longer calculates
// immediately after claims (comprehensive) or vehicle value (TPFT/TPO) --
// it now continues into the five add-on questions first. Each test below
// keeps verifying the same underlying behavior (TPFT/TPO skip claims,
// claims answers are stored correctly, the real rating engine result is
// displayed, reset/advisor/re-prompt behavior after a quote) but drives
// the conversation through the new intermediate steps to get there.
// ---------------------------------------------------------------------

test('tpft cover skips claims history and goes directly to the add-on questions', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '2'); // tpft
    const reply = handleIncomingMessage(phone, '25000000');
    assert.match(reply, /Car Tracker/);
    assert.doesNotMatch(reply, /previous claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TRACKER);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, false);
});

test('tpo cover skips claims history and goes directly to the add-on questions', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3'); // tpo
    const reply = handleIncomingMessage(phone, '25000000');
    assert.match(reply, /Car Tracker/);
    assert.doesNotMatch(reply, /previous claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TRACKER);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, false);
});

test('answering yes to claims history stores hasClaimRecord true and moves to add-ons', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, '1'); // yes
    assert.match(reply, /Car Tracker/);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, true);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TRACKER);
});

test('answering no to claims history stores hasClaimRecord false and moves to add-ons', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, 'no');
    assert.match(reply, /Car Tracker/);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, false);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TRACKER);
});

test('the exact expected quote input object (all add-ons declined) is passed to quoteService.calculateQuote', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 0, totalDiscountsDeducted: 0, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });

    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1'); // comprehensive
    handleIncomingMessage(phone, '25000000');
    handleIncomingMessage(phone, 'yes'); // hasClaimRecord true
    answerAllAddonsNo(phone);

    assert.deepEqual(capturedInput, {
        vehicleClass: 'private_car',
        coverType: 'comprehensive',
        vehicleValue: 25000000,
        hasClaimRecord: true,
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
    });
});

test('the real premium calculated by the rating engine is displayed to the customer (no add-ons = Phase 1 result)', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1'); // comprehensive
    handleIncomingMessage(phone, '25000000');
    handleIncomingMessage(phone, 'no'); // hasClaimRecord: false -> 3.5% of 25,000,000 = 875,000
    const reply = answerAllAddonsNo(phone);

    assert.match(reply, /Vehicle Value: TZS 25,000,000/);
    assert.match(reply, /Base Premium: TZS 875,000/);
    assert.match(reply, /Optional Covers Selected: None selected/);
    assert.match(reply, /Optional Covers Loading: TZS 0/);
    assert.match(reply, /Discounts: TZS 0/);
    // 875,000 * 18% VAT = 157,500; total with VAT = 1,032,500.
    assert.match(reply, /VAT \(18%\): TZS 157,500/);
    assert.match(reply, /TOTAL PREMIUM \(incl\. VAT\): TZS 1,032,500/);
    assert.match(reply, /Standard Excess:/);
    assert.match(reply, /5% of Claim, Min TZS 350,000/);
});

test('"another" after a quote resets the session and restarts the flow', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3'); // tpo
    handleIncomingMessage(phone, '25000000');
    answerAllAddonsNo(phone);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);

    const reply = handleIncomingMessage(phone, 'another');
    assert.equal(reply, WELCOME_MESSAGE);
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_COVER);
    assert.deepEqual(session.quoteData, {});
});

test('a calculation error returns a customer-safe message and logs server-side', (t) => {
    t.mock.method(quoteService, 'calculateQuote', () => {
        throw new Error('simulated internal failure with a stack trace');
    });
    t.mock.method(console, 'error', () => {});

    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3'); // tpo
    handleIncomingMessage(phone, '25000000');
    const reply = answerAllAddonsNo(phone);

    assert.equal(reply, CALCULATION_ERROR_MESSAGE);
    assert.doesNotMatch(reply, /simulated internal failure/);
    assert.doesNotMatch(reply, /Error:/);
    assert.ok(console.error.mock.calls.length > 0);
});

test('replying "2" after a quote returns the advisor handoff message', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3');
    handleIncomingMessage(phone, '25000000');
    answerAllAddonsNo(phone);
    const reply = handleIncomingMessage(phone, '2');
    assert.match(reply, /advisor will assist you/i);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});

test('unrecognized input after a quote re-prompts instead of resetting', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3');
    handleIncomingMessage(phone, '25000000');
    answerAllAddonsNo(phone);
    const reply = handleIncomingMessage(phone, 'what now?');
    assert.match(reply, /didn't recognise that option/i);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});

// ---------------------------------------------------------------------
// Stage 2: add-on questions
// ---------------------------------------------------------------------

function reachTracker(phone) {
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1'); // comprehensive
    handleIncomingMessage(phone, '25000000');
    handleIncomingMessage(phone, 'no'); // hasClaimRecord
}

// 2/3/4: Car Tracker
test('tracker: yes stores addonCarTracker true and advances to loss of use', () => {
    const phone = freshPhone();
    reachTracker(phone);
    const reply = handleIncomingMessage(phone, '1');
    assert.match(reply, /Loss of Use/);
    assert.equal(getSession(phone).quoteData.addonCarTracker, true);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_LOSS_OF_USE);
});

test('tracker: no stores addonCarTracker false and advances to loss of use', () => {
    const phone = freshPhone();
    reachTracker(phone);
    const reply = handleIncomingMessage(phone, '2');
    assert.match(reply, /Loss of Use/);
    assert.equal(getSession(phone).quoteData.addonCarTracker, false);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_LOSS_OF_USE);
});

test('tracker: invalid response re-prompts and does not advance', () => {
    const phone = freshPhone();
    reachTracker(phone);
    const reply = handleIncomingMessage(phone, 'sure');
    assert.match(reply, /Please reply with:\s*\n1\. Yes\s*\n2\. No/);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TRACKER);
});

// 5/6/7: Loss of Use
function reachLossOfUse(phone) {
    reachTracker(phone);
    handleIncomingMessage(phone, '2'); // tracker no
}

test('loss of use: yes stores addonLossOfUse true and advances to excess buy-back', () => {
    const phone = freshPhone();
    reachLossOfUse(phone);
    const reply = handleIncomingMessage(phone, 'yes');
    assert.match(reply, /Excess Buy-Back/);
    assert.equal(getSession(phone).quoteData.addonLossOfUse, true);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_EXCESS_BUYBACK);
});

test('loss of use: no stores addonLossOfUse false and advances to excess buy-back', () => {
    const phone = freshPhone();
    reachLossOfUse(phone);
    const reply = handleIncomingMessage(phone, 'no');
    assert.match(reply, /Excess Buy-Back/);
    assert.equal(getSession(phone).quoteData.addonLossOfUse, false);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_EXCESS_BUYBACK);
});

test('loss of use: invalid response re-prompts and does not advance', () => {
    const phone = freshPhone();
    reachLossOfUse(phone);
    const reply = handleIncomingMessage(phone, 'dunno');
    assert.match(reply, /Please reply with:\s*\n1\. Yes\s*\n2\. No/);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_LOSS_OF_USE);
});

// 8/9/10: Excess Buy-Back
function reachExcessBuyback(phone) {
    reachLossOfUse(phone);
    handleIncomingMessage(phone, '2'); // loss of use no
}

test('excess buy-back: yes stores addonExcessBuyBack true and advances to geographical', () => {
    const phone = freshPhone();
    reachExcessBuyback(phone);
    const reply = handleIncomingMessage(phone, 'y');
    assert.match(reply, /Geographical Extension/);
    assert.equal(getSession(phone).quoteData.addonExcessBuyBack, true);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_GEOGRAPHICAL);
});

test('excess buy-back: no stores addonExcessBuyBack false and advances to geographical', () => {
    const phone = freshPhone();
    reachExcessBuyback(phone);
    const reply = handleIncomingMessage(phone, 'n');
    assert.match(reply, /Geographical Extension/);
    assert.equal(getSession(phone).quoteData.addonExcessBuyBack, false);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_GEOGRAPHICAL);
});

test('excess buy-back: invalid response re-prompts and does not advance', () => {
    const phone = freshPhone();
    reachExcessBuyback(phone);
    const reply = handleIncomingMessage(phone, 'idk');
    assert.match(reply, /Please reply with:\s*\n1\. Yes\s*\n2\. No/);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_EXCESS_BUYBACK);
});

// 11/12/13: Geographical Extension
function reachGeographical(phone) {
    reachExcessBuyback(phone);
    handleIncomingMessage(phone, '2'); // excess buy-back no
}

test('geographical: yes stores addonGeographical true and advances to TPPD gate', () => {
    const phone = freshPhone();
    reachGeographical(phone);
    const reply = handleIncomingMessage(phone, '1');
    assert.match(reply, /Third Party Property Damage/);
    assert.equal(getSession(phone).quoteData.addonGeographical, true);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TPPD);
});

test('geographical: no stores addonGeographical false and advances to TPPD gate', () => {
    const phone = freshPhone();
    reachGeographical(phone);
    const reply = handleIncomingMessage(phone, '2');
    assert.match(reply, /Third Party Property Damage/);
    assert.equal(getSession(phone).quoteData.addonGeographical, false);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TPPD);
});

test('geographical: invalid response re-prompts and does not advance', () => {
    const phone = freshPhone();
    reachGeographical(phone);
    const reply = handleIncomingMessage(phone, 'nah maybe');
    assert.match(reply, /Please reply with:\s*\n1\. Yes\s*\n2\. No/);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_GEOGRAPHICAL);
});

// 14/15/16/17: Increased TPPD
function reachTppdGate(phone) {
    reachGeographical(phone);
    handleIncomingMessage(phone, '2'); // geographical no
}

test('TPPD: no produces addonIncreasedTPPD 0 and calculates immediately', () => {
    const phone = freshPhone();
    reachTppdGate(phone);
    const reply = handleIncomingMessage(phone, '2');
    assert.match(reply, /YOUR MOTOR INSURANCE QUOTE/);
    assert.equal(getSession(phone).quoteData.addonIncreasedTPPD, 0);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});

test('TPPD: yes proceeds to amount collection instead of calculating', () => {
    const phone = freshPhone();
    reachTppdGate(phone);
    const reply = handleIncomingMessage(phone, 'yes');
    assert.match(reply, /increase the TPPD limit/i);
    assert.doesNotMatch(reply, /YOUR MOTOR INSURANCE QUOTE/);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TPPD);
    assert.equal(getSession(phone).quoteData.awaitingTppdAmount, true);
});

test('TPPD: a valid amount is passed unchanged into quoteService (not a percentage, not a premium)', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 1, totalDiscountsDeducted: 0, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });

    const phone = freshPhone();
    reachTppdGate(phone);
    handleIncomingMessage(phone, 'yes');
    handleIncomingMessage(phone, '20,000,000');

    assert.equal(capturedInput.addonIncreasedTPPD, 20000000);
});

test('TPPD: an invalid amount is rejected and re-prompted without advancing', () => {
    const phone = freshPhone();
    reachTppdGate(phone);
    handleIncomingMessage(phone, 'yes');

    for (const badAmount of ['zero', '0', '-20000000', 'not a number']) {
        const reply = handleIncomingMessage(phone, badAmount);
        assert.match(reply, /positive amount in TZS/i);
        assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_TPPD);
        assert.equal(getSession(phone).quoteData.awaitingTppdAmount, true);
    }
});

// ---------------------------------------------------------------------
// Combinations A-G. Combos B-F use a mock to assert the exact structured
// input reaches quoteService (no invented premium numbers). Combo A and
// the "all add-ons" combo (G) additionally run through the real,
// unmocked quoteService/ratingEngine and compare the displayed message
// against that same real result, proving the integration actually works.
// ---------------------------------------------------------------------

function driveAddons(phone, { tracker, lossOfUse, excessBuyBack, geographical, tppdAmount }) {
    handleIncomingMessage(phone, tracker ? 'yes' : 'no');
    handleIncomingMessage(phone, lossOfUse ? 'yes' : 'no');
    handleIncomingMessage(phone, excessBuyBack ? 'yes' : 'no');
    handleIncomingMessage(phone, geographical ? 'yes' : 'no');
    if (tppdAmount > 0) {
        handleIncomingMessage(phone, 'yes');
        return handleIncomingMessage(phone, String(tppdAmount));
    }
    return handleIncomingMessage(phone, 'no');
}

// A. All add-ons disabled (real engine) -- same coverage as the updated
// Phase 1 "real premium" test above; combination A is intentionally that
// same scenario per the task's own numbering.

// B. Tracker only
test('combination B: tracker only reaches quoteService with the correct structured input', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 0, totalDiscountsDeducted: 1, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });
    const phone = freshPhone();
    reachTracker(phone);
    driveAddons(phone, { tracker: true, lossOfUse: false, excessBuyBack: false, geographical: false, tppdAmount: 0 });

    assert.equal(capturedInput.addonCarTracker, true);
    assert.equal(capturedInput.addonLossOfUse, false);
    assert.equal(capturedInput.addonExcessBuyBack, false);
    assert.equal(capturedInput.addonGeographical, false);
    assert.equal(capturedInput.addonIncreasedTPPD, 0);
});

test('combination B (real): tracker-only quote matches the real quoteService/ratingEngine result exactly', () => {
    const input = {
        ...BASE_QUOTE_INPUT,
        coverType: 'comprehensive',
        vehicleValue: 25000000,
        hasClaimRecord: false,
        addonCarTracker: true,
        addonLossOfUse: false,
        addonExcessBuyBack: false,
        addonGeographical: false,
        addonIncreasedTPPD: 0
    };
    const expected = quoteService.calculateQuote(input).result;

    const phone = freshPhone();
    reachTracker(phone);
    const reply = driveAddons(phone, { tracker: true, lossOfUse: false, excessBuyBack: false, geographical: false, tppdAmount: 0 });

    assert.match(reply, new RegExp(`Base Premium: TZS ${expected.summary.calculatedBasePremium.toLocaleString('en-US')}`));
    assert.match(reply, new RegExp(`VAT \\(18%\\): TZS ${expected.summary.vatAmount.toLocaleString('en-US')}`));
    assert.match(
        reply,
        new RegExp(`TOTAL PREMIUM \\(incl\\. VAT\\): TZS ${expected.summary.payablePremiumWithVAT.toLocaleString('en-US')}`)
    );
    assert.match(reply, /Optional Covers Selected: Car Tracker/);
    // Proves the add-on genuinely changed the result rather than being ignored.
    assert.notEqual(expected.summary.payablePremiumTZS, expected.summary.calculatedBasePremium);
    // VAT is exactly 18% of the pre-VAT payable premium, rounded.
    assert.equal(expected.summary.vatAmount, Math.round(expected.summary.payablePremiumTZS * 0.18));
    assert.equal(expected.summary.payablePremiumWithVAT, expected.summary.payablePremiumTZS + expected.summary.vatAmount);
});

// C. Loss of Use only
test('combination C: loss of use only reaches quoteService with the correct structured input', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 1, totalDiscountsDeducted: 0, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });
    const phone = freshPhone();
    reachTracker(phone);
    driveAddons(phone, { tracker: false, lossOfUse: true, excessBuyBack: false, geographical: false, tppdAmount: 0 });

    assert.equal(capturedInput.addonCarTracker, false);
    assert.equal(capturedInput.addonLossOfUse, true);
    assert.equal(capturedInput.addonExcessBuyBack, false);
    assert.equal(capturedInput.addonGeographical, false);
    assert.equal(capturedInput.addonIncreasedTPPD, 0);
});

// D. Excess Buy-Back only
test('combination D: excess buy-back only reaches quoteService with the correct structured input', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 1, totalDiscountsDeducted: 0, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });
    const phone = freshPhone();
    reachTracker(phone);
    driveAddons(phone, { tracker: false, lossOfUse: false, excessBuyBack: true, geographical: false, tppdAmount: 0 });

    assert.equal(capturedInput.addonCarTracker, false);
    assert.equal(capturedInput.addonLossOfUse, false);
    assert.equal(capturedInput.addonExcessBuyBack, true);
    assert.equal(capturedInput.addonGeographical, false);
    assert.equal(capturedInput.addonIncreasedTPPD, 0);
});

// E. Geographical Extension only
test('combination E: geographical extension only reaches quoteService with the correct structured input', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 1, totalDiscountsDeducted: 0, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });
    const phone = freshPhone();
    reachTracker(phone);
    driveAddons(phone, { tracker: false, lossOfUse: false, excessBuyBack: false, geographical: true, tppdAmount: 0 });

    assert.equal(capturedInput.addonCarTracker, false);
    assert.equal(capturedInput.addonLossOfUse, false);
    assert.equal(capturedInput.addonExcessBuyBack, false);
    assert.equal(capturedInput.addonGeographical, true);
    assert.equal(capturedInput.addonIncreasedTPPD, 0);
});

// F. Multiple add-ons together
test('combination F: multiple add-ons together reach quoteService with the correct structured input', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 1, totalDiscountsDeducted: 1, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });
    const phone = freshPhone();
    reachTracker(phone);
    driveAddons(phone, { tracker: true, lossOfUse: true, excessBuyBack: false, geographical: true, tppdAmount: 0 });

    assert.equal(capturedInput.addonCarTracker, true);
    assert.equal(capturedInput.addonLossOfUse, true);
    assert.equal(capturedInput.addonExcessBuyBack, false);
    assert.equal(capturedInput.addonGeographical, true);
    assert.equal(capturedInput.addonIncreasedTPPD, 0);
});

// G. All available add-ons, including a numeric increased TPPD amount
test('combination G: all add-ons enabled reach quoteService with the correct structured input', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, totalAddonLoadings: 1, totalDiscountsDeducted: 1, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });
    const phone = freshPhone();
    reachTracker(phone);
    driveAddons(phone, { tracker: true, lossOfUse: true, excessBuyBack: true, geographical: true, tppdAmount: 20000000 });

    assert.deepEqual(capturedInput, {
        vehicleClass: 'private_car',
        coverType: 'comprehensive',
        vehicleValue: 25000000,
        hasClaimRecord: false,
        carryingPassengers: false,
        tonnage: 0,
        seatsCount: 0,
        isTatoaTaboaMember: false,
        isEligibleFleet: false,
        addonExcessBuyBack: true,
        addonLossOfUse: true,
        addonGeographical: true,
        addonIncreasedTPPD: 20000000,
        addonCarTracker: true
    });
});

test('combination G (real): all add-ons enabled matches the real quoteService/ratingEngine result exactly', () => {
    const input = {
        ...BASE_QUOTE_INPUT,
        coverType: 'comprehensive',
        vehicleValue: 25000000,
        hasClaimRecord: false,
        addonCarTracker: true,
        addonLossOfUse: true,
        addonExcessBuyBack: true,
        addonGeographical: true,
        addonIncreasedTPPD: 20000000
    };
    const expected = quoteService.calculateQuote(input).result;

    const phone = freshPhone();
    reachTracker(phone);
    const reply = driveAddons(phone, { tracker: true, lossOfUse: true, excessBuyBack: true, geographical: true, tppdAmount: 20000000 });

    assert.match(reply, new RegExp(`Base Premium: TZS ${expected.summary.calculatedBasePremium.toLocaleString('en-US')}`));
    assert.match(
        reply,
        new RegExp(`Optional Covers Loading: TZS ${expected.summary.totalAddonLoadings.toLocaleString('en-US')}`)
    );
    assert.match(reply, new RegExp(`Discounts: TZS ${expected.summary.totalDiscountsDeducted.toLocaleString('en-US')}`));
    assert.match(reply, new RegExp(`VAT \\(18%\\): TZS ${expected.summary.vatAmount.toLocaleString('en-US')}`));
    assert.match(
        reply,
        new RegExp(`TOTAL PREMIUM \\(incl\\. VAT\\): TZS ${expected.summary.payablePremiumWithVAT.toLocaleString('en-US')}`)
    );
    assert.equal(expected.summary.vatAmount, Math.round(expected.summary.payablePremiumTZS * 0.18));
    assert.equal(expected.summary.payablePremiumWithVAT, expected.summary.payablePremiumTZS + expected.summary.vatAmount);
    assert.match(reply, /Car Tracker/);
    assert.match(reply, /Loss of Use/);
    assert.match(reply, /Excess Buy-Back/);
    assert.match(reply, /Geographical Extension/);
    assert.match(reply, /Increased TPPD \(\+TZS 20,000,000 above base limit\)/);
});
