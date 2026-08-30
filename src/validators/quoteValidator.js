/**
 * Input validation and sanitization for quote requests.
 * This is the system boundary: raw, untrusted request bodies are checked
 * and normalized here before ever reaching the rating engine.
 */

const VEHICLE_CLASSES = [
    'private_car',
    'motorcycle',
    'three_wheeler',
    'commercial_goods_own',
    'commercial_goods_general',
    'passenger_carrying',
    'special_type',
    'trailer_standard',
    'trailer_conversion',
    'oil_tanker_steel',
    'oil_tanker_aluminum',
    'oil_tanker_over_10y'
];

const COVER_TYPES = ['comprehensive', 'tpft', 'tpo'];

const PASSENGER_SUB_TYPES = [
    'taxi_tour',
    'daladala',
    'bus_up_country',
    'bus_private',
    'bus_school'
];

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function toBoolean(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
    return isFiniteNumber(value) && value >= 0 ? value : fallback;
}

/**
 * Validates and normalizes a raw quote request body.
 * @param {unknown} body
 * @returns {{ valid: true, data: object } | { valid: false, errors: string[] }}
 */
function validateQuoteRequest(body) {
    const errors = [];

    if (!isPlainObject(body)) {
        return { valid: false, errors: ['Request body must be a JSON object.'] };
    }

    const { vehicleClass, coverType, vehicleValue, subType } = body;

    if (typeof vehicleClass !== 'string' || !VEHICLE_CLASSES.includes(vehicleClass)) {
        errors.push(`vehicleClass is required and must be one of: ${VEHICLE_CLASSES.join(', ')}`);
    }

    if (typeof coverType !== 'string' || !COVER_TYPES.includes(coverType)) {
        errors.push(`coverType is required and must be one of: ${COVER_TYPES.join(', ')}`);
    }

    if (!isFiniteNumber(vehicleValue) || vehicleValue < 0) {
        errors.push('vehicleValue is required and must be a non-negative number.');
    }

    if (vehicleClass === 'passenger_carrying') {
        if (typeof subType !== 'string' || !PASSENGER_SUB_TYPES.includes(subType)) {
            errors.push(`subType is required for passenger_carrying and must be one of: ${PASSENGER_SUB_TYPES.join(', ')}`);
        }
    } else if (subType !== undefined && subType !== '' && !PASSENGER_SUB_TYPES.includes(subType)) {
        errors.push(`subType, if provided, must be one of: ${PASSENGER_SUB_TYPES.join(', ')}`);
    }

    if (errors.length > 0) {
        return { valid: false, errors };
    }

    const data = {
        vehicleClass,
        coverType,
        vehicleValue,
        subType: subType || '',
        hasClaimRecord: toBoolean(body.hasClaimRecord),
        carryingPassengers: toBoolean(body.carryingPassengers),
        tonnage: toNonNegativeNumber(body.tonnage),
        seatsCount: Math.max(0, Math.trunc(toNonNegativeNumber(body.seatsCount))),
        isTatoaTaboaMember: toBoolean(body.isTatoaTaboaMember),
        isEligibleFleet: toBoolean(body.isEligibleFleet),
        addonExcessBuyBack: toBoolean(body.addonExcessBuyBack),
        addonLossOfUse: toBoolean(body.addonLossOfUse),
        addonGeographical: toBoolean(body.addonGeographical),
        addonIncreasedTPPD: toNonNegativeNumber(body.addonIncreasedTPPD),
        addonCarTracker: toBoolean(body.addonCarTracker)
    };

    return { valid: true, data };
}

module.exports = {
    validateQuoteRequest,
    VEHICLE_CLASSES,
    COVER_TYPES,
    PASSENGER_SUB_TYPES
};
