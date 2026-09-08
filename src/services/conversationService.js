/**
 * WhatsApp conversation state machine for the private-car quoting flow
 * (Stage 1 / Option B). This module owns conversation logic only —
 * parsing customer replies, tracking state in sessionStore, and formatting
 * responses. It never calculates a premium itself: all quote math goes
 * through quoteService, the same path the HTTP /api/v1/quotes endpoint
 * uses, so there is exactly one source of truth for premiums.
 */

const sessionStore = require('./sessionStore');
const quoteService = require('./quoteService');

const { SESSION_STATES } = sessionStore;

const COVER_TYPE_LABELS = {
    comprehensive: 'Comprehensive',
    tpft: 'Third Party, Fire & Theft (TPFT)',
    tpo: 'Third Party Only (TPO)'
};

const WELCOME_MESSAGE =
    'Welcome to Insurance Quoting.\n\n' +
    'I can help you get a private car insurance quote.\n\n' +
    'Please select your cover:\n\n' +
    '1. Comprehensive\n' +
    '2. Third Party, Fire & Theft (TPFT)\n' +
    '3. Third Party Only (TPO)\n\n' +
    'Reply with 1, 2, or 3.';

const INVALID_COVER_MESSAGE =
    "I didn't recognise that selection.\n\n" +
    'Please reply with:\n' +
    '1. Comprehensive\n' +
    '2. TPFT\n' +
    '3. TPO';

const VEHICLE_VALUE_PROMPT =
    'What is the current value of the vehicle in TZS?\n\n' +
    'Example: 25,000,000';

const INVALID_VEHICLE_VALUE_MESSAGE =
    'Please enter the vehicle value as a positive amount in TZS.\n\n' +
    'Example: 25,000,000';

const CLAIMS_PROMPT =
    'Does the vehicle have a previous claim record?\n\n' +
    '1. Yes\n' +
    '2. No\n\n' +
    'Reply with 1 or 2.';

const INVALID_CLAIMS_MESSAGE =
    'Please reply with:\n' +
    '1. Yes\n' +
    '2. No';

const CALCULATION_ERROR_MESSAGE =
    "Sorry, I couldn't calculate that quote at the moment.\n\n" +
    'Please try again or contact an advisor.';

const ADVISOR_MESSAGE =
    'An advisor will assist you. Please provide your preferred contact details or wait for an advisor to contact you.';

const INVALID_NEXT_ACTION_MESSAGE =
    "I didn't recognise that option.\n\n" +
    'Would you like to:\n\n' +
    '1. Get another quote\n' +
    '2. Speak to an advisor';

function normalizeText(text) {
    return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

function formatTZS(amount) {
    const rounded = Math.round(Number(amount) || 0);
    return `TZS ${rounded.toLocaleString('en-US')}`;
}

function parseCoverSelection(rawText) {
    const text = normalizeText(rawText);
    if (text === '1' || text === 'comprehensive') return 'comprehensive';
    if (
        text === '2' ||
        text === 'tpft' ||
        text === 'third party fire and theft' ||
        text === 'third party, fire & theft'
    ) {
        return 'tpft';
    }
    if (text === '3' || text === 'tpo' || text === 'third party only') return 'tpo';
    return null;
}

function parseVehicleValue(rawText) {
    if (typeof rawText !== 'string') return null;

    let cleaned = rawText.trim().replace(/^tzs\.?\s*/i, '');
    cleaned = cleaned.replace(/,/g, '').replace(/\s+/g, '');

    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

    const value = Number(cleaned);
    if (!Number.isFinite(value) || value <= 0) return null;

    return value;
}

function parseClaimsResponse(rawText) {
    const text = normalizeText(rawText);
    if (text === '1' || text === 'yes' || text === 'y') return true;
    if (text === '2' || text === 'no' || text === 'n') return false;
    return null;
}

function parseNextAction(rawText) {
    const text = normalizeText(rawText);
    if (['1', 'another', 'another quote', 'new quote', 'start again'].includes(text)) return 'restart';
    if (['2', 'advisor', 'agent', 'human'].includes(text)) return 'advisor';
    return null;
}

function buildQuoteMessage(quoteData, engineResult) {
    const coverLabel = COVER_TYPE_LABELS[quoteData.coverType] || quoteData.coverType;
    const basePremium = engineResult.summary.calculatedBasePremium;
    const totalPremium = engineResult.summary.payablePremiumTZS;
    const excessRule = engineResult.complianceDetails.excessMandateRule;

    return (
        'YOUR MOTOR INSURANCE QUOTE\n\n' +
        'Vehicle: Private Car\n' +
        `Cover: ${coverLabel}\n` +
        `Vehicle Value: ${formatTZS(quoteData.vehicleValue)}\n\n` +
        `Base Premium: ${formatTZS(basePremium)}\n` +
        `Total Premium: ${formatTZS(totalPremium)}\n\n` +
        'Standard Excess:\n' +
        `${excessRule}\n\n` +
        'Would you like to:\n\n' +
        '1. Get another quote\n' +
        '2. Speak to an advisor'
    );
}

/**
 * Runs the collected quoteData through quoteService (validator + rating
 * engine) and returns the customer-facing reply. Never throws.
 */
function calculateAndRespond(phoneNumber, quoteData) {
    sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.CALCULATING });

    const quoteInput = {
        vehicleClass: 'private_car',
        coverType: quoteData.coverType,
        vehicleValue: quoteData.vehicleValue,
        hasClaimRecord: quoteData.hasClaimRecord,
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

    let outcome;
    try {
        outcome = quoteService.calculateQuote(quoteInput);
    } catch (err) {
        console.error('WhatsApp quote calculation threw an unexpected error:', err);
        sessionStore.resetSession(phoneNumber);
        return CALCULATION_ERROR_MESSAGE;
    }

    if (!outcome.success) {
        console.error('WhatsApp quote calculation rejected its own input:', outcome.errors);
        sessionStore.resetSession(phoneNumber);
        return CALCULATION_ERROR_MESSAGE;
    }

    sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.QUOTE_READY });
    const message = buildQuoteMessage(quoteData, outcome.result);
    sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.AWAITING_NEXT_ACTION });

    return message;
}

function routeMessage(phoneNumber, rawText) {
    const session = sessionStore.getOrCreateSession(phoneNumber);

    // A brand-new session (or one left over from before this flow existed)
    // always starts the private-car quoting conversation.
    if (session.state === SESSION_STATES.NEW || session.state === SESSION_STATES.IN_PROGRESS) {
        sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.PRIVATE_CAR_COVER, quoteData: {} });
        return WELCOME_MESSAGE;
    }

    if (session.state === SESSION_STATES.PRIVATE_CAR_COVER) {
        const coverType = parseCoverSelection(rawText);
        if (!coverType) {
            return INVALID_COVER_MESSAGE;
        }
        sessionStore.updateSession(phoneNumber, {
            quoteData: { ...session.quoteData, coverType },
            state: SESSION_STATES.PRIVATE_CAR_VALUE
        });
        return VEHICLE_VALUE_PROMPT;
    }

    if (session.state === SESSION_STATES.PRIVATE_CAR_VALUE) {
        const vehicleValue = parseVehicleValue(rawText);
        if (vehicleValue === null) {
            return INVALID_VEHICLE_VALUE_MESSAGE;
        }

        const quoteData = { ...session.quoteData, vehicleClass: 'private_car', vehicleValue };

        if (quoteData.coverType === 'comprehensive') {
            sessionStore.updateSession(phoneNumber, { quoteData, state: SESSION_STATES.PRIVATE_CAR_CLAIMS });
            return CLAIMS_PROMPT;
        }

        quoteData.hasClaimRecord = false;
        sessionStore.updateSession(phoneNumber, { quoteData });
        return calculateAndRespond(phoneNumber, quoteData);
    }

    if (session.state === SESSION_STATES.PRIVATE_CAR_CLAIMS) {
        const hasClaimRecord = parseClaimsResponse(rawText);
        if (hasClaimRecord === null) {
            return INVALID_CLAIMS_MESSAGE;
        }

        const quoteData = { ...session.quoteData, hasClaimRecord };
        sessionStore.updateSession(phoneNumber, { quoteData });
        return calculateAndRespond(phoneNumber, quoteData);
    }

    if (session.state === SESSION_STATES.QUOTE_READY || session.state === SESSION_STATES.AWAITING_NEXT_ACTION) {
        const action = parseNextAction(rawText);

        if (action === 'restart') {
            sessionStore.resetSession(phoneNumber);
            sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.PRIVATE_CAR_COVER, quoteData: {} });
            return WELCOME_MESSAGE;
        }

        if (action === 'advisor') {
            return ADVISOR_MESSAGE;
        }

        return INVALID_NEXT_ACTION_MESSAGE;
    }

    // Defensive fallback for any state not otherwise handled.
    sessionStore.resetSession(phoneNumber);
    sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.PRIVATE_CAR_COVER, quoteData: {} });
    return WELCOME_MESSAGE;
}

/**
 * Advances the given sender's conversation by one turn and returns the
 * reply text to send back. Never throws — any unexpected internal error
 * is logged server-side and turned into a customer-safe message.
 */
function handleIncomingMessage(phoneNumber, rawText) {
    try {
        return routeMessage(phoneNumber, rawText);
    } catch (err) {
        console.error('Unexpected error handling WhatsApp conversation:', err);
        try {
            sessionStore.resetSession(phoneNumber);
        } catch (_resetErr) {
            // best-effort cleanup only
        }
        return CALCULATION_ERROR_MESSAGE;
    }
}

module.exports = {
    handleIncomingMessage,
    CALCULATION_ERROR_MESSAGE,
    WELCOME_MESSAGE
};
