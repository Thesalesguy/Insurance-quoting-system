/**
 * Deterministic, rule-based natural-language fact extraction for the
 * WhatsApp conversation (Phase 3D).
 *
 * This module ONLY identifies what the customer said -- vehicle type,
 * cover, value, claims history, add-ons, and so on -- as structured
 * facts with a confidence tier. It NEVER calculates, estimates, or
 * selects a premium, rate, or discount: it has no access to
 * ratingEngine.js or quoteService, and produces nothing but plain data.
 * Everything it returns still has to pass conversationService's own
 * deterministic validation against vehicleCatalog.js's canonical value
 * lists before it is ever accepted into quoteData.
 *
 * No external LLM/API is used here. Every recognized phrase below is a
 * fixed, literal rule (regex/keyword matching), so behaviour is fully
 * predictable and testable -- every example in the Phase 3D spec is
 * solvable this way without introducing a model-dependent black box.
 */

const catalog = require('./vehicleCatalog');

function lower(text) {
    return typeof text === 'string' ? text.toLowerCase() : '';
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary phrase match, so "car" never matches inside "carry" or "scared". */
function containsPhrase(text, phrase) {
    return new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i').test(text);
}

function textContainsAny(text, phrases) {
    return phrases.some((phrase) => containsPhrase(text, phrase));
}

/**
 * Strips a trailing correction clause ("..., not X" / "... but not X") so
 * the negated fragment is never extracted as a positive fact. Only
 * strips a clause that is clearly a correction (preceded by a comma or
 * "but"), never a message that legitimately starts with "not".
 */
function stripNegationTail(text) {
    return text
        .replace(/,\s*(?:but\s+)?not\s+.+$/i, '')
        .replace(/\s+but\s+not\s+.+$/i, '');
}

function addFact(facts, field, value, confidence) {
    facts[field] = { value, confidence, source: 'customer_message' };
}

// ---------------------------------------------------------------------
// Vehicle class / subtype
// ---------------------------------------------------------------------

function extractVehicleClass(text, facts, ambiguities) {
    // Oil tanker: only ever resolved from material + manufacture year,
    // exactly as the menu-driven flow does (see deriveOilTankerClass) --
    // never guessed from the word "tanker" alone.
    const mentionsTanker = containsPhrase(text, 'tanker');
    let material = null;
    if (textContainsAny(text, ['aluminium', 'aluminum'])) material = 'aluminium';
    else if (containsPhrase(text, 'steel')) material = 'steel';

    const yearMatch =
        text.match(/(?:made|manufactured|built)\s+in\s+(\d{4})/i) ||
        text.match(/\byear\s+(\d{4})/i) ||
        (mentionsTanker || material ? text.match(/\b(19[7-9]\d|20[0-4]\d)\b/) : null);
    const year = yearMatch ? Number(yearMatch[1]) : null;

    if (material && year) {
        const vehicleClass = catalog.deriveOilTankerClass(material, year);
        addFact(facts, 'vehicleClass', vehicleClass, 'high');
        return;
    }
    if (material && mentionsTanker) {
        // Known material, year not yet given -- store it as a transient
        // fact so the conversation can skip straight to the year
        // question instead of re-asking the material.
        addFact(facts, '_tankerMaterial', material, 'high');
        return;
    }
    if (mentionsTanker) {
        ambiguities.push({ type: 'tanker_generic', field: 'vehicleClass', message: 'Customer mentioned a tanker without material/year.' });
        return;
    }

    // Motorcycle / three-wheeler: unambiguous informal terms.
    if (textContainsAny(text, ['bodaboda', 'boda boda', 'boda', 'motorcycle', 'motorbike'])) {
        addFact(facts, 'vehicleClass', 'motorcycle', 'high');
        return;
    }
    if (textContainsAny(text, ['bajaji', 'bajaj', 'three-wheeler', 'three wheeler', 'tuk tuk', 'tuktuk'])) {
        addFact(facts, 'vehicleClass', 'three_wheeler', 'high');
        return;
    }

    // Passenger vehicle subtypes -- check specific subtypes before the
    // generic "bus" fallback so a specific answer is never downgraded to
    // an ambiguity.
    if (containsPhrase(text, 'daladala')) {
        addFact(facts, 'vehicleClass', 'passenger_carrying', 'high');
        addFact(facts, 'subType', 'daladala', 'high');
        return;
    }
    if (textContainsAny(text, ['school bus'])) {
        addFact(facts, 'vehicleClass', 'passenger_carrying', 'high');
        addFact(facts, 'subType', 'bus_school', 'high');
        return;
    }
    if (textContainsAny(text, ['up-country bus', 'up country bus', 'upcountry bus'])) {
        addFact(facts, 'vehicleClass', 'passenger_carrying', 'high');
        addFact(facts, 'subType', 'bus_up_country', 'high');
        return;
    }
    if (textContainsAny(text, ['private bus'])) {
        addFact(facts, 'vehicleClass', 'passenger_carrying', 'high');
        addFact(facts, 'subType', 'bus_private', 'high');
        return;
    }
    if (textContainsAny(text, ['taxi', 'tour vehicle']) || (containsPhrase(text, 'tour') && containsPhrase(text, 'vehicle'))) {
        addFact(facts, 'vehicleClass', 'passenger_carrying', 'high');
        addFact(facts, 'subType', 'taxi_tour', 'high');
        return;
    }
    if (containsPhrase(text, 'bus')) {
        ambiguities.push({ type: 'bus_generic', field: 'subType', message: 'Customer mentioned a bus without a specific subtype.' });
        return;
    }

    // Goods vehicle ownership -- check explicit ownership phrasing before
    // the generic "truck"/"lorry" fallback.
    const mentionsGoods = textContainsAny(text, ['truck', 'lorry', 'goods vehicle', 'goods carrying']);
    const ownGoods = textContainsAny(text, [
        'my own goods', 'our own goods', "my own company's goods", "our company's goods",
        'my own business', 'our own business', 'belongs to me', 'belongs to us', 'my goods', 'our goods'
    ]);
    const generalGoods = textContainsAny(text, [
        "customers' goods", 'customers goods', "customer's goods", "other people's goods",
        'third party goods', 'general cargo', 'goods for hire', 'hire of goods', "others' goods"
    ]);
    if (ownGoods) {
        addFact(facts, 'vehicleClass', 'commercial_goods_own', 'high');
        return;
    }
    if (generalGoods) {
        addFact(facts, 'vehicleClass', 'commercial_goods_general', 'high');
        return;
    }
    if (mentionsGoods) {
        ambiguities.push({ type: 'goods_vehicle_generic', field: 'vehicleClass', message: 'Customer mentioned a goods vehicle without ownership information.' });
        return;
    }

    // Trailer.
    if (textContainsAny(text, ['standard trailer'])) {
        addFact(facts, 'vehicleClass', 'trailer_standard', 'high');
        return;
    }
    if (textContainsAny(text, ['converted trailer', 'modified trailer', 'conversion trailer'])) {
        addFact(facts, 'vehicleClass', 'trailer_conversion', 'high');
        return;
    }
    if (containsPhrase(text, 'trailer')) {
        ambiguities.push({ type: 'trailer_generic', field: 'vehicleClass', message: 'Customer mentioned a trailer without a specific type.' });
        return;
    }

    // Private car -- explicit phrasing is high confidence; a bare generic
    // word is only medium confidence and must be confirmed before use.
    if (textContainsAny(text, ['private car'])) {
        addFact(facts, 'vehicleClass', 'private_car', 'high');
        return;
    }
    if (textContainsAny(text, ['my car', 'saloon car'])) {
        addFact(facts, 'vehicleClass', 'private_car', 'high');
        return;
    }
    if (textContainsAny(text, ['car', 'sedan', 'saloon'])) {
        addFact(facts, 'vehicleClass', 'private_car', 'medium');
    }
}

// ---------------------------------------------------------------------
// Cover type
// ---------------------------------------------------------------------

function extractCoverType(text, facts) {
    if (textContainsAny(text, ['third party fire and theft', 'third party fire & theft', 'third party, fire and theft', 'tpft'])) {
        addFact(facts, 'coverType', 'tpft', 'high');
        return;
    }
    if (textContainsAny(text, ['full comprehensive', 'comprehensive', 'comp cover'])) {
        addFact(facts, 'coverType', 'comprehensive', 'high');
        return;
    }
    if (textContainsAny(text, ['just third party', 'third party only', 'tpo', 'third party'])) {
        addFact(facts, 'coverType', 'tpo', 'high');
    }
}

// ---------------------------------------------------------------------
// Claims history
// ---------------------------------------------------------------------

function extractClaims(text, facts) {
    if (textContainsAny(text, [
        'no claims', 'no claim record', 'no claim', 'clean record', 'never claimed',
        "haven't had a claim", 'have not had a claim', 'no accident'
    ])) {
        addFact(facts, 'hasClaimRecord', false, 'high');
        return;
    }
    if (textContainsAny(text, [
        'one claim', 'have a claim', 'had a claim', 'has claims', 'with claims', 'made a claim'
    ])) {
        addFact(facts, 'hasClaimRecord', true, 'high');
    }
}

// ---------------------------------------------------------------------
// Passenger-for-hire use (motorcycle / three-wheeler only)
// ---------------------------------------------------------------------

function extractForHire(text, facts) {
    if (textContainsAny(text, [
        'not for hire', 'private use only', 'no passengers', 'personal use only'
    ])) {
        addFact(facts, 'carryingPassengers', false, 'high');
        return;
    }
    if (textContainsAny(text, [
        'for passengers', 'carry passengers', 'carries passengers', 'passengers for hire',
        'used for hire', 'for hire', 'commercial use'
    ])) {
        addFact(facts, 'carryingPassengers', true, 'high');
    }
}

// ---------------------------------------------------------------------
// Add-ons -- recognized purely as customer requests, never priced here.
// ---------------------------------------------------------------------

function extractAddons(text, facts) {
    if (textContainsAny(text, ['no extras', 'no add-ons', 'no addons', 'no optional covers', 'nothing else'])) {
        addFact(facts, 'noExtras', true, 'high');
    }
    if (textContainsAny(text, ['loss of use'])) {
        addFact(facts, 'addonLossOfUse', true, 'high');
    }
    if (textContainsAny(text, ['car tracker', 'tracker'])) {
        addFact(facts, 'addonCarTracker', true, 'high');
    }
    if (textContainsAny(text, ['excess buy back', 'excess buy-back', 'excess buyback'])) {
        addFact(facts, 'addonExcessBuyBack', true, 'high');
    }
    if (textContainsAny(text, ['geographical extension', 'geographical cover', 'geographical area'])) {
        addFact(facts, 'addonGeographical', true, 'high');
    }
}

// ---------------------------------------------------------------------
// Numbers: money (vehicle value / TPPD), seats, tonnage.
// ---------------------------------------------------------------------

function parseNumberToken(numStr) {
    const value = Number(numStr.replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
}

function windowHas(window, word) {
    return new RegExp(`\\b${escapeRegex(word)}`, 'i').test(window);
}

function findMoneyMentions(text) {
    const mentions = [];
    const millionRegex = /(\d[\d,]*(?:\.\d+)?)\s*(?:million|mil|m)\b/gi;
    const tzsRegex = /tzs\.?\s*(\d[\d,]*(?:\.\d+)?)/gi;
    const commaRegex = /\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?)\b/g;

    let match;
    while ((match = millionRegex.exec(text)) !== null) {
        const base = parseNumberToken(match[1]);
        if (base !== null) mentions.push({ value: base * 1000000, index: match.index, end: match.index + match[0].length });
    }
    while ((match = tzsRegex.exec(text)) !== null) {
        const value = parseNumberToken(match[1]);
        if (value !== null) mentions.push({ value, index: match.index, end: match.index + match[0].length });
    }
    while ((match = commaRegex.exec(text)) !== null) {
        const value = parseNumberToken(match[1]);
        if (value !== null) mentions.push({ value, index: match.index, end: match.index + match[0].length });
    }

    mentions.sort((a, b) => a.index - b.index);
    return mentions;
}

function extractNumbers(text, facts) {
    const mentions = findMoneyMentions(text);
    let vehicleValueTaken = false;
    for (const mention of mentions) {
        // TPPD can be named either just before ("TPPD of 100 million") or
        // just after ("100 million TPPD") the amount, so its window looks
        // both ways; seats/tonnage counts are never money-formatted
        // themselves, so this only guards the rare case of a plain number
        // immediately followed by a unit word (e.g. "45" right before
        // "seats") rather than any unrelated mention later in the message.
        const tppdWindow = text.slice(Math.max(0, mention.index - 20), Math.min(text.length, mention.end + 20));
        // Only treated as a seat/tonnage count (not a money value) when the
        // unit word immediately follows with nothing but whitespace in
        // between -- e.g. "45 seats" -- so an unrelated tonnage/seat
        // mention later in the same sentence never swallows a real money
        // amount (as in "worth 20 million, 7 tonnes").
        const immediateUnit = text.slice(mention.end, mention.end + 15).match(/^\s*(seats?|tonnes?|tons?)\b/i);
        if (windowHas(tppdWindow, 'tppd')) {
            addFact(facts, 'addonIncreasedTPPD', mention.value, 'high');
            continue;
        }
        if (immediateUnit) {
            continue; // handled by the dedicated seat/tonnage patterns below
        }
        if (!vehicleValueTaken) {
            addFact(facts, 'vehicleValue', mention.value, 'high');
            vehicleValueTaken = true;
        }
    }

    const seatsMatch = text.match(/(\d+)\s*seats?\b/i);
    if (seatsMatch) {
        addFact(facts, 'seatsCount', Number(seatsMatch[1]), 'high');
    }

    const tonnageMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:tonnes?|tons?)\b/i);
    if (tonnageMatch) {
        addFact(facts, 'tonnage', Number(tonnageMatch[1]), 'high');
    }
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Extracts structured facts from a free-text customer message. Pure and
 * deterministic: the same input always produces the same output, and
 * nothing here ever computes a premium, rate, or discount.
 *
 * Output shape:
 * {
 *   facts: { <field>: { value, confidence: 'high'|'medium', source: 'customer_message' } },
 *   ambiguities: [{ type, field, message }],
 *   unrecognized: [],
 *   corrections: [<field names that overwrite a differing already-known value>]
 * }
 *
 * @param {string} rawText
 * @param {object} [contextQuoteData] - current known quoteData, used only
 *   to flag which extracted facts are corrections of an existing value.
 */
function extractFacts(rawText, contextQuoteData = {}) {
    const facts = {};
    const ambiguities = [];
    const unrecognized = [];

    const original = typeof rawText === 'string' ? rawText : '';
    const text = lower(stripNegationTail(original));

    if (!text.trim()) {
        return { facts, ambiguities, unrecognized, corrections: [] };
    }

    extractVehicleClass(text, facts, ambiguities);
    extractCoverType(text, facts);
    extractClaims(text, facts);
    extractForHire(text, facts);
    extractAddons(text, facts);
    extractNumbers(text, facts);

    const corrections = [];
    for (const [field, fact] of Object.entries(facts)) {
        if (fact.confidence !== 'high') continue;
        const existing = contextQuoteData ? contextQuoteData[field] : undefined;
        if (existing !== undefined && existing !== fact.value) {
            corrections.push(field);
        }
    }

    return { facts, ambiguities, unrecognized, corrections };
}

module.exports = { extractFacts };
