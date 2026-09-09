/**
 * Customer-facing <-> internal rating-engine vocabulary, and the rules for
 * which questions/options are actually relevant for a given vehicle class
 * and cover type.
 *
 * This module is pure data and lookup logic only — no premium calculation,
 * no session handling, no I/O. Every rule here was derived by reading
 * ratingEngine.js's own branches (see the comment above each table), never
 * guessed, so the conversation layer never asks a question the engine
 * would ignore and never offers a class/cover combination the engine
 * doesn't actually support.
 */

function normalizeText(text) {
    return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

/**
 * Generic menu-option matcher shared by every menu-style question in the
 * conversation (category, cover, goods ownership, passenger subtype,
 * trailer type, tanker material, yes/no). Options are
 * { value, label, numbers: [...], keywords: [...] }.
 */
function matchMenuOption(rawText, options) {
    const text = normalizeText(rawText);
    if (!text) return null;
    for (const option of options) {
        if (option.numbers.includes(text)) return option.value;
        if (option.keywords && option.keywords.includes(text)) return option.value;
    }
    return null;
}

/** Builds a numbered "N. Label" menu block from an options array, renumbered 1..N. */
function buildMenuText(options) {
    return options.map((option, index) => `${index + 1}. ${option.label}`).join('\n');
}

// ---------------------------------------------------------------------
// 1. Customer-facing vehicle category menu (never the internal 12 classes)
// ---------------------------------------------------------------------

const CATEGORY_OPTIONS = [
    { value: 'PRIVATE_CAR', label: 'Private car', numbers: ['1'], keywords: ['private car', 'car'] },
    { value: 'MOTORCYCLE', label: 'Motorcycle / Bodaboda', numbers: ['2'], keywords: ['motorcycle', 'bodaboda', 'boda boda'] },
    { value: 'THREE_WHEELER', label: 'Three-wheeler / Bajaji', numbers: ['3'], keywords: ['three-wheeler', 'three wheeler', 'bajaji', 'bajaj'] },
    { value: 'GOODS_VEHICLE', label: 'Goods vehicle', numbers: ['4'], keywords: ['goods vehicle', 'goods', 'truck', 'lorry'] },
    { value: 'PASSENGER_VEHICLE', label: 'Passenger vehicle / Bus', numbers: ['5'], keywords: ['passenger vehicle', 'bus'] },
    { value: 'TRAILER', label: 'Trailer', numbers: ['6'], keywords: ['trailer'] },
    { value: 'OIL_TANKER', label: 'Oil tanker', numbers: ['7'], keywords: ['oil tanker', 'tanker'] },
    { value: 'SPECIAL_VEHICLE', label: 'Special vehicle', numbers: ['8'], keywords: ['special vehicle', 'special'] }
];

function parseCategorySelection(rawText) {
    return matchMenuOption(rawText, CATEGORY_OPTIONS);
}

// ---------------------------------------------------------------------
// 2. Cover types, and exactly which ones each internal class supports.
// Derived directly from which coverType branches exist per vehicleClass
// in ratingEngine.js — a class/cover pair not listed here has no branch
// in the engine at all (it would silently fall through to a 0 premium),
// so it must never be offered or accepted.
// ---------------------------------------------------------------------

const COVER_TYPE_META = {
    comprehensive: { label: 'Comprehensive', keywords: ['comprehensive'] },
    tpft: { label: 'Third Party Fire & Theft', keywords: ['tpft', 'third party fire and theft', 'third party fire & theft', 'third party, fire & theft'] },
    tpo: { label: 'Third Party Only', keywords: ['tpo', 'third party only', 'third party'] }
};

const ALL_COVER_TYPES = ['comprehensive', 'tpft', 'tpo'];

const VALID_COVERS_BY_CLASS = {
    private_car: ['comprehensive', 'tpft', 'tpo'],
    motorcycle: ['comprehensive', 'tpft', 'tpo'],
    three_wheeler: ['comprehensive', 'tpft', 'tpo'],
    commercial_goods_own: ['comprehensive', 'tpft', 'tpo'],
    commercial_goods_general: ['comprehensive', 'tpft', 'tpo'],
    trailer_standard: ['comprehensive', 'tpo'], // no tpft branch in ratingEngine.js
    trailer_conversion: ['comprehensive', 'tpo'], // no tpft branch in ratingEngine.js
    oil_tanker_steel: ['comprehensive', 'tpft', 'tpo'],
    oil_tanker_aluminum: ['comprehensive', 'tpft', 'tpo'],
    oil_tanker_over_10y: ['comprehensive', 'tpft', 'tpo'],
    passenger_carrying: ['comprehensive', 'tpo'], // no tpft branch in ratingEngine.js
    special_type: ['comprehensive', 'tpo'] // no tpft branch in ratingEngine.js
};

function getValidCoverTypes(vehicleClass) {
    return VALID_COVERS_BY_CLASS[vehicleClass] || [];
}

/** Builds the {value,label,numbers,keywords} option list for this class's cover menu, renumbered 1..N. */
function buildCoverOptions(vehicleClass) {
    return getValidCoverTypes(vehicleClass).map((coverType, index) => ({
        value: coverType,
        label: COVER_TYPE_META[coverType].label,
        numbers: [String(index + 1)],
        keywords: COVER_TYPE_META[coverType].keywords
    }));
}

/**
 * Result: 'valid' (matches an offered option), 'unsupported' (recognizably
 * one of the 3 real cover types, but not offered for this class), or
 * 'unrecognized' (matches nothing).
 */
function parseCoverSelection(rawText, vehicleClass) {
    const options = buildCoverOptions(vehicleClass);
    const matched = matchMenuOption(rawText, options);
    if (matched) return { status: 'valid', coverType: matched };

    // Recognize the cover type by name even when it's not on this class's
    // menu, so we can give the specific "not available" message rather
    // than a generic "didn't understand".
    const text = normalizeText(rawText);
    for (const coverType of ALL_COVER_TYPES) {
        if (COVER_TYPE_META[coverType].keywords.includes(text)) {
            return { status: 'unsupported', coverType };
        }
    }
    return { status: 'unrecognized' };
}

// ---------------------------------------------------------------------
// 3. Claims-history relevance. hasClaimRecord only affects a class's
// premium inside the comprehensive branch's own ternary/rate choice —
// several classes' comprehensive formulas are flat and never read it at
// all, so asking would violate "ask the minimum questions necessary".
// ---------------------------------------------------------------------

const CLAIMS_AFFECTS_COMPREHENSIVE_RATE = {
    private_car: true,
    motorcycle: true,
    three_wheeler: true,
    commercial_goods_own: true,
    commercial_goods_general: true,
    trailer_standard: true,
    trailer_conversion: true,
    oil_tanker_steel: false, // flat rate regardless of claim history
    oil_tanker_aluminum: false,
    oil_tanker_over_10y: false,
    special_type: false // flat rate regardless of claim history
    // passenger_carrying handled separately below (depends on subType)
};

function isClaimsQuestionRequired(vehicleClass, subType, coverType) {
    if (coverType !== 'comprehensive') return false;
    if (vehicleClass === 'passenger_carrying') {
        // Only the taxi_tour formula reads hasClaimRecord; daladala/bus
        // subtypes use a flat formula that never consults it.
        return subType === 'taxi_tour';
    }
    return Boolean(CLAIMS_AFFECTS_COMPREHENSIVE_RATE[vehicleClass]);
}

// ---------------------------------------------------------------------
// 4. Other conditional fields.
// ---------------------------------------------------------------------

/** Tonnage only tiers the TPO rate for goods vehicles; comprehensive/tpft never read it. */
function isTonnageQuestionRequired(vehicleClass, coverType) {
    return (vehicleClass === 'commercial_goods_own' || vehicleClass === 'commercial_goods_general') && coverType === 'tpo';
}

/** Seats always factor into every passenger_carrying formula, any cover. */
function isSeatsQuestionRequired(vehicleClass) {
    return vehicleClass === 'passenger_carrying';
}

/** carryingPassengers (for-hire use) only affects motorcycle/three_wheeler formulas. */
function isForHireQuestionRequired(vehicleClass) {
    return vehicleClass === 'motorcycle' || vehicleClass === 'three_wheeler';
}

/**
 * Vehicle value (sumInsured) is read by every comprehensive formula and by
 * every tpft formula (where tpft exists) in ratingEngine.js. It is NOT
 * read anywhere in any class's tpo branch -- those are all flat,
 * tonnage-tiered, or seat-tiered figures that never multiply by
 * sumInsured. So for a "purely third-party" (TPO) cover, on any vehicle
 * class, asking for the vehicle value would ask the customer for a
 * number the engine is guaranteed to ignore.
 */
function isVehicleValueRequired(coverType) {
    return coverType !== 'tpo';
}

// ---------------------------------------------------------------------
// 5. Optional add-on applicability — mirrors the guard conditions in
// ratingEngine.js's own add-on block exactly, so nothing is offered that
// the engine would silently ignore.
// ---------------------------------------------------------------------

const ADDON_APPLICABILITY = {
    addonCarTracker: () => true, // flat discount, no guard in the engine
    addonIncreasedTPPD: () => true, // no guard in the engine
    addonExcessBuyBack: (vehicleClass, coverType) => coverType === 'comprehensive',
    addonGeographical: (vehicleClass, coverType) => coverType === 'comprehensive',
    addonLossOfUse: (vehicleClass, coverType) => vehicleClass === 'private_car' && coverType === 'comprehensive'
};

const ADDON_ORDER = ['addonCarTracker', 'addonLossOfUse', 'addonExcessBuyBack', 'addonGeographical', 'addonIncreasedTPPD'];

const ADDON_LABELS = {
    addonCarTracker: 'Tracker',
    addonLossOfUse: 'Loss of Use',
    addonExcessBuyBack: 'Excess Buy-Back',
    addonGeographical: 'Geographical Extension',
    addonIncreasedTPPD: 'Increased TPPD'
};

/** Ordered list of addon field names actually applicable for this class/cover. */
function getApplicableAddons(vehicleClass, coverType) {
    return ADDON_ORDER.filter((field) => ADDON_APPLICABILITY[field](vehicleClass, coverType));
}

// ---------------------------------------------------------------------
// 6. Goods vehicle ownership mapping (hides commercial_goods_own/general).
// ---------------------------------------------------------------------

const GOODS_OWNERSHIP_OPTIONS = [
    { value: 'commercial_goods_own', label: 'Goods belonging to me or my business', numbers: ['1'], keywords: ['own', 'my own', 'mine', 'business'] },
    { value: 'commercial_goods_general', label: 'Goods belonging to customers or other parties', numbers: ['2'], keywords: ['general', 'customers', 'third party goods', 'others'] }
];

function parseGoodsOwnership(rawText) {
    return matchMenuOption(rawText, GOODS_OWNERSHIP_OPTIONS);
}

// ---------------------------------------------------------------------
// 7. Passenger vehicle subtype mapping (hides internal subType codes).
// ---------------------------------------------------------------------

const PASSENGER_SUBTYPE_OPTIONS = [
    { value: 'taxi_tour', label: 'Taxi / tour vehicle', numbers: ['1'], keywords: ['taxi', 'tour', 'taxi / tour vehicle'] },
    { value: 'daladala', label: 'Daladala / urban commuter bus', numbers: ['2'], keywords: ['daladala', 'urban commuter bus', 'commuter'] },
    { value: 'bus_up_country', label: 'Up-country bus', numbers: ['3'], keywords: ['up-country bus', 'up country bus', 'upcountry'] },
    { value: 'bus_private', label: 'Private bus', numbers: ['4'], keywords: ['private bus'] },
    { value: 'bus_school', label: 'School bus', numbers: ['5'], keywords: ['school bus'] }
];

function parsePassengerSubtype(rawText) {
    return matchMenuOption(rawText, PASSENGER_SUBTYPE_OPTIONS);
}

// ---------------------------------------------------------------------
// 8. Trailer type mapping.
// ---------------------------------------------------------------------

const TRAILER_TYPE_OPTIONS = [
    { value: 'trailer_standard', label: 'Standard trailer', numbers: ['1'], keywords: ['standard', 'standard trailer'] },
    { value: 'trailer_conversion', label: 'Converted / modified trailer', numbers: ['2'], keywords: ['converted', 'conversion', 'modified'] }
];

function parseTrailerType(rawText) {
    return matchMenuOption(rawText, TRAILER_TYPE_OPTIONS);
}

// ---------------------------------------------------------------------
// 9. Oil tanker: derive the internal class from material + age, never
// ask the customer to self-classify.
// ---------------------------------------------------------------------

const OIL_TANKER_MATERIAL_OPTIONS = [
    { value: 'steel', label: 'Steel', numbers: ['1'], keywords: ['steel'] },
    { value: 'aluminium', label: 'Aluminium', numbers: ['2'], keywords: ['aluminium', 'aluminum'] }
];

function parseOilTankerMaterial(rawText) {
    return matchMenuOption(rawText, OIL_TANKER_MATERIAL_OPTIONS);
}

/**
 * @param {string} material - 'steel' | 'aluminium'
 * @param {number} manufactureYear
 * @param {number} [currentYear] - defaults to the current calendar year
 */
function deriveOilTankerClass(material, manufactureYear, currentYear = new Date().getFullYear()) {
    const age = currentYear - manufactureYear;
    if (age > 10) return 'oil_tanker_over_10y';
    return material === 'aluminium' ? 'oil_tanker_aluminum' : 'oil_tanker_steel';
}

// ---------------------------------------------------------------------
// 10. Shared yes/no option set (used for claims, for-hire, optional
// covers gate, each individual addon question, and the oil-tanker
// pre-check).
// ---------------------------------------------------------------------

const YES_NO_OPTIONS = [
    { value: true, label: 'Yes', numbers: ['1'], keywords: ['yes', 'y'] },
    { value: false, label: 'No', numbers: ['2'], keywords: ['no', 'n'] }
];

function parseYesNo(rawText) {
    const text = normalizeText(rawText);
    for (const option of YES_NO_OPTIONS) {
        if (option.numbers.includes(text) || option.keywords.includes(text)) return option.value;
    }
    return null;
}

// ---------------------------------------------------------------------
// 11. Customer-friendly display label for a resolved internal class
// (+ subType where relevant) — used only for showing the confirmation
// and final quote screens back to the customer, never sent anywhere.
// ---------------------------------------------------------------------

const PASSENGER_SUBTYPE_LABELS = {
    taxi_tour: 'Taxi / Tour',
    daladala: 'Daladala',
    bus_up_country: 'Up-Country Bus',
    bus_private: 'Private Bus',
    bus_school: 'School Bus'
};

function getVehicleDisplayLabel(vehicleClass, subType) {
    switch (vehicleClass) {
        case 'private_car': return 'Private Car';
        case 'motorcycle': return 'Motorcycle / Bodaboda';
        case 'three_wheeler': return 'Three-Wheeler / Bajaji';
        case 'commercial_goods_own': return 'Goods Vehicle (Own Goods)';
        case 'commercial_goods_general': return 'Goods Vehicle (Third-Party Goods)';
        case 'passenger_carrying': return `Passenger Vehicle (${PASSENGER_SUBTYPE_LABELS[subType] || subType})`;
        case 'trailer_standard': return 'Trailer (Standard)';
        case 'trailer_conversion': return 'Trailer (Converted)';
        case 'oil_tanker_steel': return 'Oil Tanker (Steel)';
        case 'oil_tanker_aluminum': return 'Oil Tanker (Aluminium)';
        case 'oil_tanker_over_10y': return 'Oil Tanker (Over 10 Years)';
        case 'special_type': return 'Special Vehicle';
        default: return vehicleClass;
    }
}

module.exports = {
    normalizeText,
    matchMenuOption,
    buildMenuText,
    CATEGORY_OPTIONS,
    parseCategorySelection,
    COVER_TYPE_META,
    ALL_COVER_TYPES,
    getValidCoverTypes,
    buildCoverOptions,
    parseCoverSelection,
    isClaimsQuestionRequired,
    isTonnageQuestionRequired,
    isSeatsQuestionRequired,
    isForHireQuestionRequired,
    isVehicleValueRequired,
    getApplicableAddons,
    ADDON_LABELS,
    GOODS_OWNERSHIP_OPTIONS,
    parseGoodsOwnership,
    PASSENGER_SUBTYPE_OPTIONS,
    parsePassengerSubtype,
    TRAILER_TYPE_OPTIONS,
    parseTrailerType,
    OIL_TANKER_MATERIAL_OPTIONS,
    parseOilTankerMaterial,
    deriveOilTankerClass,
    YES_NO_OPTIONS,
    parseYesNo,
    getVehicleDisplayLabel
};
