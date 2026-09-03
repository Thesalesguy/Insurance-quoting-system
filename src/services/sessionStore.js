/**
 * In-memory WhatsApp conversation session store.
 *
 * No database exists yet, so sessions live only in process memory and are
 * lost on restart or (on Render's free tier) when the service spins down
 * after idling. That's acceptable for this stage: it just gives the future
 * quotation conversation somewhere to keep state between messages.
 */

const sessions = new Map();

const SESSION_STATES = Object.freeze({
    NEW: 'NEW',
    IN_PROGRESS: 'IN_PROGRESS'
});

function getOrCreateSession(phoneNumber) {
    let session = sessions.get(phoneNumber);
    if (!session) {
        session = {
            phoneNumber,
            state: SESSION_STATES.NEW,
            quoteData: {},
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
