const { calculateTIRAComprehensiveMotorPremium } = require('../../ratingEngine');
const { validateQuoteRequest, VEHICLE_CLASSES, COVER_TYPES, PASSENGER_SUB_TYPES } = require('../validators/quoteValidator');

function postQuote(req, res) {
    const validation = validateQuoteRequest(req.body);

    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            errors: validation.errors
        });
    }

    const result = calculateTIRAComprehensiveMotorPremium(validation.data);

    return res.status(200).json(result);
}

function getMetadata(req, res) {
    res.status(200).json({
        success: true,
        data: {
            vehicleClasses: VEHICLE_CLASSES,
            coverTypes: COVER_TYPES,
            passengerSubTypes: PASSENGER_SUB_TYPES
        }
    });
}

module.exports = { postQuote, getMetadata };
