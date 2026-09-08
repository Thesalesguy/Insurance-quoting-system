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

// 1. New user receives welcome/cover selection.
test('new user receives the welcome message and cover selection prompt', () => {
    const phone = freshPhone();
    const reply = handleIncomingMessage(phone, 'hello');
    assert.equal(reply, WELCOME_MESSAGE);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_COVER);
});

// 2. Comprehensive selection works.
test('comprehensive cover selection is stored and advances to vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'hi');
    const reply = handleIncomingMessage(phone, '1');
    assert.match(reply, /current value of the vehicle/i);
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_VALUE);
    assert.equal(session.quoteData.coverType, 'comprehensive');
});

// 3. TPFT selection works.
test('tpft cover selection is stored and advances to vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '2');
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_VALUE);
    assert.equal(session.quoteData.coverType, 'tpft');
});

// 4. TPO selection works.
test('tpo cover selection is stored and advances to vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, 'tpo');
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_VALUE);
    assert.equal(session.quoteData.coverType, 'tpo');
});

// 5. Invalid cover selection does not advance state.
test('invalid cover selection re-prompts and does not advance state', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    const reply = handleIncomingMessage(phone, 'banana');
    assert.match(reply, /didn't recognise that selection/i);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_COVER);
});

// 6. Numeric vehicle value works.
test('plain numeric vehicle value is normalized', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1'); // comprehensive, so quoteData is still inspectable mid-flow
    handleIncomingMessage(phone, '25000000');
    assert.equal(getSession(phone).quoteData.vehicleValue, 25000000);
});

// 7. Vehicle value with commas works.
test('comma-formatted vehicle value is normalized', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25,000,000');
    assert.equal(getSession(phone).quoteData.vehicleValue, 25000000);
});

// 8. Vehicle value with TZS prefix works.
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

// 9. Invalid vehicle value does not advance state.
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

// 10. Comprehensive asks for claims history.
test('comprehensive cover asks for claims history after a valid vehicle value', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    const reply = handleIncomingMessage(phone, '25000000');
    assert.match(reply, /previous claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_CLAIMS);
});

// 11. TPFT does not ask claims history.
test('tpft cover skips claims history and returns a quote directly', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '2');
    const reply = handleIncomingMessage(phone, '25000000');
    assert.match(reply, /YOUR MOTOR INSURANCE QUOTE/);
    assert.doesNotMatch(reply, /previous claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});

// 12. TPO does not ask claims history.
test('tpo cover skips claims history and returns a quote directly', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3');
    const reply = handleIncomingMessage(phone, '25000000');
    assert.match(reply, /YOUR MOTOR INSURANCE QUOTE/);
    assert.doesNotMatch(reply, /previous claim record/i);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});

// 13. Yes claim response stores true.
test('answering yes to claims history stores hasClaimRecord true', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, '1');
    assert.match(reply, /YOUR MOTOR INSURANCE QUOTE/);
    // quoteData is only cleared on reset, so after calculation the last known
    // value is still readable via the session for verification purposes.
    assert.equal(getSession(phone).quoteData.hasClaimRecord, true);
});

// 14. No claim response stores false.
test('answering no to claims history stores hasClaimRecord false', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, 'no');
    assert.match(reply, /YOUR MOTOR INSURANCE QUOTE/);
    assert.equal(getSession(phone).quoteData.hasClaimRecord, false);
});

// 15. Invalid claims response does not advance state.
test('invalid claims response re-prompts and does not advance state', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, 'maybe');
    assert.match(reply, /Please reply with:\s*\n1\. Yes\s*\n2\. No/);
    assert.equal(getSession(phone).state, SESSION_STATES.PRIVATE_CAR_CLAIMS);
});

// 16. Correct quote input is sent to the existing quote calculation path.
test('the exact expected quote input object is passed to quoteService.calculateQuote', (t) => {
    let capturedInput = null;
    t.mock.method(quoteService, 'calculateQuote', (input) => {
        capturedInput = input;
        return {
            success: true,
            result: {
                summary: { calculatedBasePremium: 1, payablePremiumTZS: 1 },
                complianceDetails: { excessMandateRule: 'test rule' }
            }
        };
    });

    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1'); // comprehensive
    handleIncomingMessage(phone, '25000000');
    handleIncomingMessage(phone, 'yes');

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

// 17. Returned premium is displayed to customer.
test('the real premium calculated by the rating engine is displayed to the customer', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '1'); // comprehensive
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, 'no'); // hasClaimRecord: false -> 3.5% of 25,000,000 = 875,000

    assert.match(reply, /Vehicle Value: TZS 25,000,000/);
    assert.match(reply, /Base Premium: TZS 875,000/);
    assert.match(reply, /Total Premium: TZS 875,000/);
    assert.match(reply, /Standard Excess:/);
    assert.match(reply, /5% of Claim, Min TZS 350,000/);
});

// 18. A second customer has an independent session.
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

// 19. "another quote" resets the quote.
test('"another" after a quote resets the session and restarts the flow', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3'); // tpo, quote returned immediately
    handleIncomingMessage(phone, '25000000');
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);

    const reply = handleIncomingMessage(phone, 'another');
    assert.equal(reply, WELCOME_MESSAGE);
    const session = getSession(phone);
    assert.equal(session.state, SESSION_STATES.PRIVATE_CAR_COVER);
    assert.deepEqual(session.quoteData, {});
});

// 20. Calculation errors return a customer-safe message.
test('a calculation error returns a customer-safe message and logs server-side', (t) => {
    t.mock.method(quoteService, 'calculateQuote', () => {
        throw new Error('simulated internal failure with a stack trace');
    });
    t.mock.method(console, 'error', () => {});

    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3'); // tpo -> calculates immediately
    const reply = handleIncomingMessage(phone, '25000000');

    assert.equal(reply, CALCULATION_ERROR_MESSAGE);
    assert.doesNotMatch(reply, /simulated internal failure/);
    assert.doesNotMatch(reply, /Error:/);
    assert.ok(console.error.mock.calls.length > 0);
});

// 21. Existing tests continue to pass: verified by running the full suite (see task report).

// Bonus: advisor handoff.
test('replying "2" after a quote returns the advisor handoff message', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, '2');
    assert.match(reply, /advisor will assist you/i);
    // Advisor handoff does not reset the conversation.
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});

// Bonus: unrecognized input after a quote re-prompts without resetting.
test('unrecognized input after a quote re-prompts instead of resetting', () => {
    const phone = freshPhone();
    handleIncomingMessage(phone, 'start');
    handleIncomingMessage(phone, '3');
    handleIncomingMessage(phone, '25000000');
    const reply = handleIncomingMessage(phone, 'what now?');
    assert.match(reply, /didn't recognise that option/i);
    assert.equal(getSession(phone).state, SESSION_STATES.AWAITING_NEXT_ACTION);
});
