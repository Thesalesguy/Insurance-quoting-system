/**
 * Sample quote request payloads for rapid API testing and front-end building.
 * These mirror the fields accepted by POST /api/v1/quotes.
 */

const sampleQuotes = {
    privateCarComprehensive: {
        vehicleClass: 'private_car',
        coverType: 'comprehensive',
        vehicleValue: 25000000,
        hasClaimRecord: false,
        addonCarTracker: true
    },
    privateCarThirdPartyOnly: {
        vehicleClass: 'private_car',
        coverType: 'tpo',
        vehicleValue: 15000000
    },
    motorcycleWithBodabodaLoading: {
        vehicleClass: 'motorcycle',
        coverType: 'comprehensive',
        vehicleValue: 3500000,
        hasClaimRecord: true,
        carryingPassengers: true
    },
    commercialGoodsOwnTPO: {
        vehicleClass: 'commercial_goods_own',
        coverType: 'tpo',
        vehicleValue: 40000000,
        tonnage: 7
    },
    daladalaComprehensive: {
        vehicleClass: 'passenger_carrying',
        coverType: 'comprehensive',
        subType: 'daladala',
        vehicleValue: 30000000,
        seatsCount: 30
    },
    fleetDiscountedTrailer: {
        vehicleClass: 'trailer_standard',
        coverType: 'comprehensive',
        vehicleValue: 60000000,
        isEligibleFleet: true,
        isTatoaTaboaMember: true
    }
};

module.exports = { sampleQuotes };
