/**
 * WhatsApp conversation design for the full vehicle-category quoting flow
 * (Phase 3B). This module owns conversation logic only: presenting a
 * simple customer-facing vehicle menu, asking only the questions relevant
 * to the selected vehicle/class/cover, validating and normalizing every
 * answer, and — once the customer confirms — handing a fully structured
 * quoteData object to quoteService. It NEVER calculates a premium and
 * NEVER duplicates any rating rule: every number shown to the customer
 * comes back from quoteService (validator + the existing ratingEngine),
 * the single shared calculation path for both the HTTP API and WhatsApp.
 *
 * Discounts (TATOA/TABOA membership, fleet eligibility) are internally
 * controlled and are never asked about here — see isTatoaTaboaMember/
 * isEligibleFleet below, always false, same as every prior phase.
 */

const sessionStore = require('./sessionStore');
const quoteService = require('./quoteService');
const catalog = require('./vehicleCatalog');

const { SESSION_STATES } = sessionStore;

const MAX_HISTORY = 30;

// ---------------------------------------------------------------------
// Static / simple prompts and messages
// ---------------------------------------------------------------------

const CALCULATION_ERROR_MESSAGE =
    "Sorry, I couldn't calculate that quote at the moment.\n\n" +
    'Please try again or contact an advisor.';

const ADVISOR_MESSAGE =
    'An advisor will assist you. Please provide your preferred contact details or wait for an advisor to contact you.';

const INVALID_NEXT_ACTION_MESSAGE =
    "I didn't recognise that option.\n\n" +
    'Would you like to:\n\n' +
    '1. Start another quotation\n' +
    '2. Speak to an insurance representative';

const MANUAL_REVIEW_MESSAGE =
    'This vehicle requires further underwriting review. We cannot provide an automated quotation for it at this time.';

const NOTHING_TO_GO_BACK_TO_MESSAGE = "There's nothing to go back to yet.";

function categoryMenuPrompt() {
    return (
        'Welcome to Insurance Quoting.\n\n' +
        'What type of vehicle would you like to insure?\n\n' +
        `${catalog.buildMenuText(catalog.CATEGORY_OPTIONS)}\n\n` +
        'Reply with the number of your selection.'
    );
}

const INVALID_CATEGORY_MESSAGE =
    "I didn't recognise that selection.\n\n" +
    'Please reply with one of the numbers shown:\n\n' +
    `${catalog.buildMenuText(catalog.CATEGORY_OPTIONS)}`;

const WELCOME_MESSAGE = categoryMenuPrompt();

// ---------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------

function formatTZS(amount) {
    const rounded = Math.round(Number(amount) || 0);
    return `TZS ${rounded.toLocaleString('en-US')}`;
}

function parsePositiveAmount(rawText) {
    if (typeof rawText !== 'string') return null;
    let cleaned = rawText.trim().replace(/^tzs\.?\s*/i, '');
    cleaned = cleaned.replace(/,/g, '').replace(/\s+/g, '');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
}

function parsePositiveInteger(rawText) {
    const value = parsePositiveAmount(rawText);
    if (value === null) return null;
    return Math.round(value);
}

function parseYear(rawText) {
    if (typeof rawText !== 'string') return null;
    const text = rawText.trim();
    if (!/^\d{4}$/.test(text)) return null;
    const year = Number(text);
    const currentYear = new Date().getFullYear();
    if (year < 1970 || year > currentYear) return null;
    return year;
}

function cloneQuoteData(quoteData) {
    return JSON.parse(JSON.stringify(quoteData || {}));
}

/** Pushes the pre-transition snapshot onto the history stack, capped. */
function pushHistory(session) {
    const history = Array.isArray(session.history) ? session.history.slice() : [];
    history.push({ state: session.state, quoteData: cloneQuoteData(session.quoteData) });
    if (history.length > MAX_HISTORY) history.shift();
    return history;
}

// ---------------------------------------------------------------------
// Prompt builders per state (also used to redisplay a state after
// going "back", without re-running any answer logic).
// ---------------------------------------------------------------------

function goodsOwnershipPrompt() {
    return (
        'What type of goods does the vehicle normally carry?\n\n' +
        `${catalog.buildMenuText(catalog.GOODS_OWNERSHIP_OPTIONS)}\n\n` +
        'Reply with the number of your selection.'
    );
}

function passengerSubtypePrompt() {
    return (
        'What is the vehicle mainly used for?\n\n' +
        `${catalog.buildMenuText(catalog.PASSENGER_SUBTYPE_OPTIONS)}\n\n` +
        'Reply with the number of your selection.'
    );
}

function trailerTypePrompt() {
    return (
        'What type of trailer is it?\n\n' +
        `${catalog.buildMenuText(catalog.TRAILER_TYPE_OPTIONS)}\n\n` +
        'Reply with the number of your selection.'
    );
}

function oilTankerConfirmPrompt() {
    return 'Is this vehicle an oil or petroleum tanker?\n\n1. Yes\n2. No\n\nReply with 1 or 2.';
}

function oilTankerMaterialPrompt() {
    return (
        'What is the tanker made of?\n\n' +
        `${catalog.buildMenuText(catalog.OIL_TANKER_MATERIAL_OPTIONS)}\n\n` +
        'Reply with the number of your selection.'
    );
}

function oilTankerYearPrompt() {
    return 'What is the year of manufacture?\n\nExample: 2015';
}

function specialDescriptionPrompt() {
    return 'What type of special vehicle is it, and what is it mainly used for?\n\nPlease describe it briefly.';
}

function coverTypePrompt(vehicleClass) {
    const options = catalog.buildCoverOptions(vehicleClass);
    return (
        'What type of cover would you like?\n\n' +
        `${catalog.buildMenuText(options)}\n\n` +
        'Reply with the number of your selection.'
    );
}

function vehicleValuePrompt() {
    return 'What is the current value of the vehicle in Tanzanian Shillings?\n\nExample: 25,000,000';
}

function forHirePrompt() {
    return 'Is the vehicle used to carry passengers for hire, such as a boda boda?\n\n1. Yes\n2. No\n\nReply with 1 or 2.';
}

function claimsPrompt() {
    return 'Has the vehicle had any insurance claim record?\n\n1. Yes\n2. No\n\nReply with 1 or 2.';
}

function seatsPrompt() {
    return 'How many passenger seats does the vehicle have?\n\nExample: 30';
}

function tonnagePrompt() {
    return "What is the vehicle's carrying capacity in tonnes?\n\nExample: 5";
}

function optionalCoversGatePrompt() {
    return 'Would you like to add any optional covers?\n\n1. Yes\n2. No\n\nReply with 1 or 2.';
}

function addonQuestionPrompt(addonField) {
    return `Would you like to add ${catalog.ADDON_LABELS[addonField]}?\n\n1. Yes\n2. No\n\nReply with 1 or 2.`;
}

function tppdAmountPrompt() {
    return (
        'What additional TPPD limit would you like, in Tanzanian Shillings?\n\n' +
        'This is the amount above the standard TZS 50,000,000 limit.\n\n' +
        'Example: 50,000,000'
    );
}

function buildConfirmationSummary(quoteData) {
    const vehicleLabel = catalog.getVehicleDisplayLabel(quoteData.vehicleClass, quoteData.subType);
    const coverLabel = catalog.COVER_TYPE_META[quoteData.coverType].label;

    const lines = [
        'Please confirm your quotation details:',
        '',
        `Vehicle: ${vehicleLabel}`,
        `Cover: ${coverLabel}`
    ];

    if (catalog.isVehicleValueRequired(quoteData.coverType)) {
        lines.push(`Vehicle value: ${formatTZS(quoteData.vehicleValue)}`);
    }

    if (catalog.isForHireQuestionRequired(quoteData.vehicleClass)) {
        lines.push(`Used for hire: ${quoteData.carryingPassengers ? 'Yes' : 'No'}`);
    }
    if (catalog.isSeatsQuestionRequired(quoteData.vehicleClass)) {
        lines.push(`Seats: ${quoteData.seatsCount}`);
    }
    if (catalog.isTonnageQuestionRequired(quoteData.vehicleClass, quoteData.coverType)) {
        lines.push(`Carrying capacity: ${quoteData.tonnage} tonnes`);
    }
    if (catalog.isClaimsQuestionRequired(quoteData.vehicleClass, quoteData.subType, quoteData.coverType)) {
        lines.push(`Claims record: ${quoteData.hasClaimRecord ? 'Yes' : 'No'}`);
    }

    lines.push(`Tracker: ${quoteData.addonCarTracker ? 'Yes' : 'No'}`);
    if (catalog.getApplicableAddons(quoteData.vehicleClass, quoteData.coverType).includes('addonLossOfUse')) {
        lines.push(`Loss of Use: ${quoteData.addonLossOfUse ? 'Yes' : 'No'}`);
    }
    if (catalog.getApplicableAddons(quoteData.vehicleClass, quoteData.coverType).includes('addonExcessBuyBack')) {
        lines.push(`Excess Buy-Back: ${quoteData.addonExcessBuyBack ? 'Yes' : 'No'}`);
    }
    if (catalog.getApplicableAddons(quoteData.vehicleClass, quoteData.coverType).includes('addonGeographical')) {
        lines.push(`Geographical Extension: ${quoteData.addonGeographical ? 'Yes' : 'No'}`);
    }
    lines.push(
        quoteData.addonIncreasedTPPD > 0
            ? `Increased TPPD: Yes (+${formatTZS(quoteData.addonIncreasedTPPD)})`
            : 'Increased TPPD: No'
    );

    lines.push('', '1. Confirm and calculate', '2. Change details', '3. Cancel');

    return lines.join('\n');
}

/** Redisplays the prompt for a given state (forward transition or after "back"). Returns null if the state has no standalone prompt. */
function promptFor(state, quoteData) {
    switch (state) {
        case SESSION_STATES.VEHICLE_CATEGORY: return categoryMenuPrompt();
        case SESSION_STATES.GOODS_OWNERSHIP: return goodsOwnershipPrompt();
        case SESSION_STATES.PASSENGER_SUBTYPE: return passengerSubtypePrompt();
        case SESSION_STATES.TRAILER_TYPE: return trailerTypePrompt();
        case SESSION_STATES.OIL_TANKER_CONFIRM: return oilTankerConfirmPrompt();
        case SESSION_STATES.OIL_TANKER_MATERIAL: return oilTankerMaterialPrompt();
        case SESSION_STATES.OIL_TANKER_YEAR: return oilTankerYearPrompt();
        case SESSION_STATES.SPECIAL_DESCRIPTION: return specialDescriptionPrompt();
        case SESSION_STATES.COVER_TYPE: return coverTypePrompt(quoteData.vehicleClass);
        case SESSION_STATES.VEHICLE_VALUE: return vehicleValuePrompt();
        case SESSION_STATES.PASSENGER_FOR_HIRE: return forHirePrompt();
        case SESSION_STATES.CLAIMS: return claimsPrompt();
        case SESSION_STATES.SEATS_COUNT: return seatsPrompt();
        case SESSION_STATES.TONNAGE: return tonnagePrompt();
        case SESSION_STATES.OPTIONAL_COVERS_GATE: return optionalCoversGatePrompt();
        case SESSION_STATES.ADDON_QUESTION: return addonQuestionPrompt(quoteData._addonQueue[0]);
        case SESSION_STATES.ADDON_TPPD_AMOUNT: return tppdAmountPrompt();
        case SESSION_STATES.CONFIRMATION: return buildConfirmationSummary(quoteData);
        default: return null;
    }
}

// ---------------------------------------------------------------------
// Quote result message — built purely from the customer's own recorded
// selections and the real result object returned by quoteService. No
// premium figure or add-on amount is ever computed here.
// ---------------------------------------------------------------------

function buildQuoteMessage(quoteData, engineResult, reference) {
    const vehicleLabel = catalog.getVehicleDisplayLabel(quoteData.vehicleClass, quoteData.subType);
    const coverLabel = catalog.COVER_TYPE_META[quoteData.coverType].label;
    const totalPremiumWithVAT = engineResult.summary.payablePremiumWithVAT;

    const vehicleValueLine = catalog.isVehicleValueRequired(quoteData.coverType)
        ? `Vehicle Value: ${formatTZS(quoteData.vehicleValue)}\n\n`
        : '';

    return (
        'Your quotation has been calculated.\n\n' +
        `Vehicle: ${vehicleLabel}\n` +
        `Cover: ${coverLabel}\n` +
        vehicleValueLine +
        `Premium: ${formatTZS(totalPremiumWithVAT)}\n\n` +
        `Quote Reference: ${reference}\n\n` +
        'What would you like to do next?\n\n' +
        '1. Start another quotation\n' +
        '2. Speak to an insurance representative'
    );
}

function generateQuoteReference(phoneNumber) {
    const stamp = Date.now().toString(36).toUpperCase();
    const suffix = String(phoneNumber || '').slice(-4);
    return `Q-${stamp}${suffix}`;
}

/**
 * Runs the confirmed quoteData through quoteService (validator + rating
 * engine) and returns the customer-facing reply. Never throws, and never
 * computes or estimates a premium itself.
 */
function calculateAndRespond(phoneNumber, quoteData) {
    sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.CALCULATING });

    const quoteInput = {
        vehicleClass: quoteData.vehicleClass,
        coverType: quoteData.coverType,
        vehicleValue: quoteData.vehicleValue,
        hasClaimRecord: Boolean(quoteData.hasClaimRecord),
        carryingPassengers: Boolean(quoteData.carryingPassengers),
        tonnage: quoteData.tonnage || 0,
        seatsCount: quoteData.seatsCount || 0,
        subType: quoteData.subType || '',
        isTatoaTaboaMember: false,
        isEligibleFleet: false,
        addonExcessBuyBack: Boolean(quoteData.addonExcessBuyBack),
        addonLossOfUse: Boolean(quoteData.addonLossOfUse),
        addonGeographical: Boolean(quoteData.addonGeographical),
        addonIncreasedTPPD: quoteData.addonIncreasedTPPD || 0,
        addonCarTracker: Boolean(quoteData.addonCarTracker)
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
    const reference = generateQuoteReference(phoneNumber);
    const message = buildQuoteMessage(quoteData, outcome.result, reference);
    sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.AWAITING_NEXT_ACTION });

    return message;
}

// ---------------------------------------------------------------------
// Forward-flow convergence points, shared by every vehicle category.
// ---------------------------------------------------------------------

function goTo(phoneNumber, session, newState, quoteDataPatch) {
    const history = pushHistory(session);
    const quoteData = { ...session.quoteData, ...quoteDataPatch };
    sessionStore.updateSession(phoneNumber, { state: newState, quoteData, history });
    return promptFor(newState, quoteData);
}

function afterVehicleValue(phoneNumber, session, quoteData) {
    const vc = quoteData.vehicleClass;
    if (catalog.isForHireQuestionRequired(vc)) {
        return goTo(phoneNumber, session, SESSION_STATES.PASSENGER_FOR_HIRE, quoteData);
    }
    if (catalog.isSeatsQuestionRequired(vc)) {
        return goTo(phoneNumber, session, SESSION_STATES.SEATS_COUNT, quoteData);
    }
    return afterForHireOrSeats(phoneNumber, session, quoteData);
}

function afterForHireOrSeats(phoneNumber, session, quoteData) {
    const vc = quoteData.vehicleClass;
    if (catalog.isClaimsQuestionRequired(vc, quoteData.subType, quoteData.coverType)) {
        return goTo(phoneNumber, session, SESSION_STATES.CLAIMS, quoteData);
    }
    return afterClaims(phoneNumber, session, { ...quoteData, hasClaimRecord: false });
}

function afterClaims(phoneNumber, session, quoteData) {
    const vc = quoteData.vehicleClass;
    if (catalog.isTonnageQuestionRequired(vc, quoteData.coverType)) {
        return goTo(phoneNumber, session, SESSION_STATES.TONNAGE, quoteData);
    }
    return afterTonnage(phoneNumber, session, { ...quoteData, tonnage: 0 });
}

function afterTonnage(phoneNumber, session, quoteData) {
    return goTo(phoneNumber, session, SESSION_STATES.OPTIONAL_COVERS_GATE, quoteData);
}

function startAddonQueueOrConfirm(phoneNumber, session, quoteData) {
    const queue = catalog.getApplicableAddons(quoteData.vehicleClass, quoteData.coverType);
    if (queue.length === 0) {
        return goTo(phoneNumber, session, SESSION_STATES.CONFIRMATION, quoteData);
    }
    return goTo(phoneNumber, session, SESSION_STATES.ADDON_QUESTION, { ...quoteData, _addonQueue: queue });
}

function advanceAddonQueue(phoneNumber, session, quoteData) {
    const remaining = quoteData._addonQueue.slice(1);
    if (remaining.length === 0) {
        const finalData = { ...quoteData };
        delete finalData._addonQueue;
        return goTo(phoneNumber, session, SESSION_STATES.CONFIRMATION, finalData);
    }
    return goTo(phoneNumber, session, SESSION_STATES.ADDON_QUESTION, { ...quoteData, _addonQueue: remaining });
}

// ---------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------

function routeMessage(phoneNumber, rawText) {
    const session = sessionStore.getOrCreateSession(phoneNumber);
    const text = catalog.normalizeText(rawText);

    // "back" is recognized at any state that has prior history, before
    // any state-specific parsing, since it never collides with a valid
    // answer to any question in this flow.
    if ((text === 'back' || text === 'go back') && Array.isArray(session.history) && session.history.length > 0) {
        const history = session.history.slice();
        const previous = history.pop();
        sessionStore.updateSession(phoneNumber, { state: previous.state, quoteData: previous.quoteData, history });
        return promptFor(previous.state, previous.quoteData);
    }
    if (text === 'back' || text === 'go back') {
        return NOTHING_TO_GO_BACK_TO_MESSAGE;
    }

    // "restart" is recognized everywhere too.
    if (['restart', 'start again', 'start over'].includes(text)) {
        sessionStore.resetSession(phoneNumber);
        sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.VEHICLE_CATEGORY, quoteData: {}, history: [] });
        return categoryMenuPrompt();
    }

    if (session.state === SESSION_STATES.NEW || session.state === SESSION_STATES.IN_PROGRESS) {
        sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.VEHICLE_CATEGORY, quoteData: {}, history: [] });
        return categoryMenuPrompt();
    }

    if (session.state === SESSION_STATES.VEHICLE_CATEGORY) {
        const category = catalog.parseCategorySelection(rawText);
        if (!category) return INVALID_CATEGORY_MESSAGE;

        switch (category) {
            case 'PRIVATE_CAR':
                return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, { ...session.quoteData, vehicleClass: 'private_car' });
            case 'MOTORCYCLE':
                return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, { ...session.quoteData, vehicleClass: 'motorcycle' });
            case 'THREE_WHEELER':
                return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, { ...session.quoteData, vehicleClass: 'three_wheeler' });
            case 'GOODS_VEHICLE':
                return goTo(phoneNumber, session, SESSION_STATES.GOODS_OWNERSHIP, session.quoteData);
            case 'PASSENGER_VEHICLE':
                return goTo(phoneNumber, session, SESSION_STATES.PASSENGER_SUBTYPE, session.quoteData);
            case 'TRAILER':
                return goTo(phoneNumber, session, SESSION_STATES.TRAILER_TYPE, session.quoteData);
            case 'OIL_TANKER':
                return goTo(phoneNumber, session, SESSION_STATES.OIL_TANKER_CONFIRM, session.quoteData);
            case 'SPECIAL_VEHICLE':
                return goTo(phoneNumber, session, SESSION_STATES.SPECIAL_DESCRIPTION, session.quoteData);
            default:
                return INVALID_CATEGORY_MESSAGE;
        }
    }

    if (session.state === SESSION_STATES.GOODS_OWNERSHIP) {
        const vehicleClass = catalog.parseGoodsOwnership(rawText);
        if (!vehicleClass) {
            return "Please reply with:\n1. Goods belonging to me or my business\n2. Goods belonging to customers or other parties";
        }
        return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, { ...session.quoteData, vehicleClass });
    }

    if (session.state === SESSION_STATES.PASSENGER_SUBTYPE) {
        const subType = catalog.parsePassengerSubtype(rawText);
        if (!subType) {
            return `Please reply with one of the numbers shown:\n\n${catalog.buildMenuText(catalog.PASSENGER_SUBTYPE_OPTIONS)}`;
        }
        return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, {
            ...session.quoteData,
            vehicleClass: 'passenger_carrying',
            subType
        });
    }

    if (session.state === SESSION_STATES.TRAILER_TYPE) {
        const vehicleClass = catalog.parseTrailerType(rawText);
        if (!vehicleClass) {
            return "Please reply with:\n1. Standard trailer\n2. Converted / modified trailer";
        }
        return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, { ...session.quoteData, vehicleClass });
    }

    if (session.state === SESSION_STATES.OIL_TANKER_CONFIRM) {
        const isTanker = catalog.parseYesNo(rawText);
        if (isTanker === null) {
            return 'Please reply with:\n1. Yes\n2. No';
        }
        if (!isTanker) {
            // Not actually an oil tanker: return to the vehicle menu rather
            // than misclassifying it.
            sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.VEHICLE_CATEGORY, quoteData: {}, history: [] });
            return `That doesn't sound like an oil tanker.\n\n${categoryMenuPrompt()}`;
        }
        return goTo(phoneNumber, session, SESSION_STATES.OIL_TANKER_MATERIAL, session.quoteData);
    }

    if (session.state === SESSION_STATES.OIL_TANKER_MATERIAL) {
        const material = catalog.parseOilTankerMaterial(rawText);
        if (!material) {
            return 'Please reply with:\n1. Steel\n2. Aluminium';
        }
        return goTo(phoneNumber, session, SESSION_STATES.OIL_TANKER_YEAR, { ...session.quoteData, _tankerMaterial: material });
    }

    if (session.state === SESSION_STATES.OIL_TANKER_YEAR) {
        const year = parseYear(rawText);
        if (year === null) {
            return `Please enter the year of manufacture as a 4-digit year.\n\nExample: 2015`;
        }
        const vehicleClass = catalog.deriveOilTankerClass(session.quoteData._tankerMaterial, year);
        const quoteData = { ...session.quoteData, vehicleClass };
        delete quoteData._tankerMaterial;
        return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, quoteData);
    }

    if (session.state === SESSION_STATES.SPECIAL_DESCRIPTION) {
        const description = typeof rawText === 'string' ? rawText.trim() : '';
        if (!description) {
            return specialDescriptionPrompt();
        }
        // The description is stored for underwriter context only — it is
        // never interpreted or used to choose a rating class.
        return goTo(phoneNumber, session, SESSION_STATES.COVER_TYPE, {
            ...session.quoteData,
            vehicleClass: 'special_type',
            vehicleDescription: description
        });
    }

    if (session.state === SESSION_STATES.COVER_TYPE) {
        const result = catalog.parseCoverSelection(rawText, session.quoteData.vehicleClass);
        if (result.status === 'unsupported') {
            return (
                'This cover option is not currently available for this vehicle type through automated quotation.\n\n' +
                'Please choose another cover or speak to an insurance representative.'
            );
        }
        if (result.status !== 'valid') {
            return `I didn't recognise that selection.\n\n${coverTypePrompt(session.quoteData.vehicleClass)}`;
        }

        // Changing cover type must not leave stale comprehensive-only data
        // behind (e.g. a previous claims answer or comprehensive-only
        // add-on selections) if the customer picked a different cover
        // after going back.
        const quoteData = {
            ...session.quoteData,
            coverType: result.coverType,
            hasClaimRecord: false,
            addonExcessBuyBack: false,
            addonLossOfUse: false,
            addonGeographical: false
        };

        // TPO ("purely third party") never reads vehicle value in
        // ratingEngine.js, for any vehicle class -- every tpo branch is
        // flat, tonnage-tiered, or seat-tiered. Asking for it would ask
        // the customer for a number the engine is guaranteed to ignore,
        // so skip the question entirely and pass a safe, inert 0.
        if (!catalog.isVehicleValueRequired(result.coverType)) {
            return afterVehicleValue(phoneNumber, session, { ...quoteData, vehicleValue: 0 });
        }

        return goTo(phoneNumber, session, SESSION_STATES.VEHICLE_VALUE, quoteData);
    }

    if (session.state === SESSION_STATES.VEHICLE_VALUE) {
        const vehicleValue = parsePositiveAmount(rawText);
        if (vehicleValue === null) {
            return 'Please enter the vehicle value as a number in Tanzanian Shillings.\n\nExample: 25,000,000';
        }
        return afterVehicleValue(phoneNumber, session, { ...session.quoteData, vehicleValue });
    }

    if (session.state === SESSION_STATES.PASSENGER_FOR_HIRE) {
        const carryingPassengers = catalog.parseYesNo(rawText);
        if (carryingPassengers === null) {
            return 'Please reply with:\n1. Yes\n2. No';
        }
        return afterForHireOrSeats(phoneNumber, session, { ...session.quoteData, carryingPassengers });
    }

    if (session.state === SESSION_STATES.SEATS_COUNT) {
        const seatsCount = parsePositiveInteger(rawText);
        if (seatsCount === null) {
            return 'Please enter the number of passenger seats.\n\nExample: 30';
        }
        return afterForHireOrSeats(phoneNumber, session, { ...session.quoteData, seatsCount });
    }

    if (session.state === SESSION_STATES.CLAIMS) {
        const hasClaimRecord = catalog.parseYesNo(rawText);
        if (hasClaimRecord === null) {
            return 'Please reply with:\n1. Yes\n2. No';
        }
        return afterClaims(phoneNumber, session, { ...session.quoteData, hasClaimRecord });
    }

    if (session.state === SESSION_STATES.TONNAGE) {
        const tonnage = parsePositiveAmount(rawText);
        if (tonnage === null) {
            return "Please enter the vehicle's carrying capacity in tonnes.\n\nExample: 5";
        }
        return afterTonnage(phoneNumber, session, { ...session.quoteData, tonnage });
    }

    if (session.state === SESSION_STATES.OPTIONAL_COVERS_GATE) {
        const wantsAddons = catalog.parseYesNo(rawText);
        if (wantsAddons === null) {
            return 'Please reply with:\n1. Yes\n2. No';
        }
        if (!wantsAddons) {
            return goTo(phoneNumber, session, SESSION_STATES.CONFIRMATION, {
                ...session.quoteData,
                addonCarTracker: false,
                addonLossOfUse: false,
                addonExcessBuyBack: false,
                addonGeographical: false,
                addonIncreasedTPPD: 0
            });
        }
        return startAddonQueueOrConfirm(phoneNumber, session, session.quoteData);
    }

    if (session.state === SESSION_STATES.ADDON_QUESTION) {
        const field = session.quoteData._addonQueue[0];
        const answer = catalog.parseYesNo(rawText);
        if (answer === null) {
            return 'Please reply with:\n1. Yes\n2. No';
        }

        if (field === 'addonIncreasedTPPD') {
            if (!answer) {
                return advanceAddonQueue(phoneNumber, session, { ...session.quoteData, addonIncreasedTPPD: 0 });
            }
            return goTo(phoneNumber, session, SESSION_STATES.ADDON_TPPD_AMOUNT, session.quoteData);
        }

        return advanceAddonQueue(phoneNumber, session, { ...session.quoteData, [field]: answer });
    }

    if (session.state === SESSION_STATES.ADDON_TPPD_AMOUNT) {
        const amount = parsePositiveAmount(rawText);
        if (amount === null) {
            return 'Please enter the additional TPPD limit in Tanzanian Shillings.\n\nExample: 50,000,000';
        }
        return advanceAddonQueue(phoneNumber, session, { ...session.quoteData, addonIncreasedTPPD: amount });
    }

    if (session.state === SESSION_STATES.CONFIRMATION) {
        if (text === '1' || text === 'confirm' || text === 'confirm and calculate') {
            const quoteData = { ...session.quoteData };
            delete quoteData._addonQueue;
            sessionStore.updateSession(phoneNumber, { quoteData });
            return calculateAndRespond(phoneNumber, quoteData);
        }
        if (text === '2' || text === 'change details' || text === 'change') {
            if (Array.isArray(session.history) && session.history.length > 0) {
                const history = session.history.slice();
                const previous = history.pop();
                sessionStore.updateSession(phoneNumber, { state: previous.state, quoteData: previous.quoteData, history });
                return promptFor(previous.state, previous.quoteData);
            }
            return NOTHING_TO_GO_BACK_TO_MESSAGE;
        }
        if (text === '3' || text === 'cancel') {
            sessionStore.resetSession(phoneNumber);
            sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.VEHICLE_CATEGORY, quoteData: {}, history: [] });
            return categoryMenuPrompt();
        }
        return `I didn't recognise that option.\n\n${buildConfirmationSummary(session.quoteData)}`;
    }

    if (session.state === SESSION_STATES.QUOTE_READY || session.state === SESSION_STATES.AWAITING_NEXT_ACTION) {
        if (['1', 'another', 'another quote', 'new quote', 'start another quotation'].includes(text)) {
            sessionStore.resetSession(phoneNumber);
            sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.VEHICLE_CATEGORY, quoteData: {}, history: [] });
            return categoryMenuPrompt();
        }
        if (['2', 'advisor', 'agent', 'human', 'representative', 'speak to an insurance representative'].includes(text)) {
            return ADVISOR_MESSAGE;
        }
        return INVALID_NEXT_ACTION_MESSAGE;
    }

    if (session.state === SESSION_STATES.MANUAL_REVIEW) {
        sessionStore.resetSession(phoneNumber);
        sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.VEHICLE_CATEGORY, quoteData: {}, history: [] });
        return categoryMenuPrompt();
    }

    // Defensive fallback for any state not otherwise handled.
    sessionStore.resetSession(phoneNumber);
    sessionStore.updateSession(phoneNumber, { state: SESSION_STATES.VEHICLE_CATEGORY, quoteData: {}, history: [] });
    return categoryMenuPrompt();
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
    WELCOME_MESSAGE,
    MANUAL_REVIEW_MESSAGE
};
