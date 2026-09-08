const { VEHICLE_CLASSES, COVER_TYPES, PASSENGER_SUB_TYPES } = require('../validators/quoteValidator');
const quoteService = require('../services/quoteService');

function postQuote(req, res) {
    const outcome = quoteService.calculateQuote(req.body);

    if (!outcome.success) {
        return res.status(400).json({
            success: false,
            errors: outcome.errors
        });
    }

    return res.status(200).json(outcome.result);
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
