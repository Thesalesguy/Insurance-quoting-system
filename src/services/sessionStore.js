/**
 * In-memory WhatsApp conversation session store.
 *
 * No database exists yet, so sessions live only in process memory and are
 * lost on restart or (on Render's free tier) when the service spins down
 * after idling. That's acceptable for this stage: it just gives the
 * quotation conversation somewhere to keep state between messages.
 */

const sessions = new Map();

const SESSION_STATES = Object.freeze({
    NEW: 'NEW',
    IN_PROGRESS: 'IN_PROGRESS',

    // Entry point: customer-facing vehicle category menu (Phase 3B).
    VEHICLE_CATEGORY: 'VEHICLE_CATEGORY',

    // Category-specific classification questions, run before the shared
    // cover/value/claims/add-ons tail once vehicleClass is known.
    GOODS_OWNERSHIP: 'GOODS_OWNERSHIP',
    PASSENGER_SUBTYPE: 'PASSENGER_SUBTYPE',
    TRAILER_TYPE: 'TRAILER_TYPE',
    OIL_TANKER_CONFIRM: 'OIL_TANKER_CONFIRM',
    OIL_TANKER_MATERIAL: 'OIL_TANKER_MATERIAL',
    OIL_TANKER_YEAR: 'OIL_TANKER_YEAR',
    SPECIAL_DESCRIPTION: 'SPECIAL_DESCRIPTION',

    // Shared questions, applicability gated per class/cover.
    COVER_TYPE: 'COVER_TYPE',
    VEHICLE_VALUE: 'VEHICLE_VALUE',
    PASSENGER_FOR_HIRE: 'PASSENGER_FOR_HIRE',
    CLAIMS: 'CLAIMS',
    SEATS_COUNT: 'SEATS_COUNT',
    TONNAGE: 'TONNAGE',

    // Optional covers.
    OPTIONAL_COVERS_GATE: 'OPTIONAL_COVERS_GATE',
    ADDON_QUESTION: 'ADDON_QUESTION',
    ADDON_TPPD_AMOUNT: 'ADDON_TPPD_AMOUNT',

    // Phase 3D: natural-language fact extraction asks for confirmation
    // before accepting a MEDIUM-confidence guess (e.g. a bare "car").
    NLU_CONFIRM: 'NLU_CONFIRM',

    // Confirmation and calculation.
    CONFIRMATION: 'CONFIRMATION',
    CALCULATING: 'CALCULATING',
    QUOTE_READY: 'QUOTE_READY',
    AWAITING_NEXT_ACTION: 'AWAITING_NEXT_ACTION',

    // Terminal state for risks the automated flow cannot quote.
    MANUAL_REVIEW: 'MANUAL_REVIEW'
});

function getOrCreateSession(phoneNumber) {
    let session = sessions.get(phoneNumber);
    if (!session) {
        session = {
            phoneNumber,
            state: SESSION_STATES.NEW,
            quoteData: {},
            history: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        sessions.set(phoneNumber, session);
    }
    return session;
}

function updateSession(phoneNumber, patch) {
    const session = getOrCreateSession(phoneNumber);
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    return session;
}

function resetSession(phoneNumber) {
    sessions.delete(phoneNumber);
}

module.exports = {
    getOrCreateSession,
    updateSession,
    resetSession,
    SESSION_STATES
};
