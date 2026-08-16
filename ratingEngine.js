/**
 * Official Tanzania Actuarial Motor Rating Engine
 * Supports Private, Commercial Goods, Passenger Carrying, and Special Type Vehicles
 * Based on ATI/TIRA Market Adopted Insurance Rates Guidelines
 */
function calculateTanzaniaMotorPremium(inputData) {
    const { vehicleClass, subType, coverType, vehicleValue, seatsCount } = inputData;
    
    let rate = 0;
    let minimumPremium = 0;
    let seatLoadingRate = 0;
    let finalPremium = 0;

    // --- 1. PRIVATE CARS ---
    if (vehicleClass === 'private') {
        if (coverType === 'comprehensive') {
            rate = 0.035; // 3.5% claims free
            minimumPremium = 250000;
            finalPremium = Math.max(vehicleValue * rate, minimumPremium);
        } else if (coverType === 'tpo') {
            finalPremium = 100000; // Flat TPO
        }
    } 
    
    // --- 2. COMMERCIAL GOODS VEHICLES ---
    else if (vehicleClass === 'commercial_goods') {
        if (coverType === 'comprehensive') {
            rate = 0.0425; // 4.25% own goods claims free
            minimumPremium = 500000;
            finalPremium = Math.max(vehicleValue * rate, minimumPremium);
        }
    }

    // --- 3. PASSENGER CARRYING VEHICLES (Comprehensive Only) ---
    else if (vehicleClass === 'passenger_carrying' && coverType === 'comprehensive') {
        const validSeats = seatsCount || 0;
        minimumPremium = 500000; // Standard floor for commercial passenger carrying

        if (subType === 'taxi_tour') {
            rate = 0.055; // 5.5%
            seatLoadingRate = 15000; // TZS 15,000 per seat
            finalPremium = Math.max((vehicleValue * rate) + (validSeats * seatLoadingRate), minimumPremium);
        } else if (subType === 'daladala') {
            rate = 0.08; // 8.0%
            seatLoadingRate = 15000; // TZS 15,000 per seat
            finalPremium = Math.max((vehicleValue * rate) + (validSeats * seatLoadingRate), minimumPremium);
        } else if (subType === 'bus_up_country') {
            rate = 0.08; // 8.0%
            seatLoadingRate = 30000; // TZS 30,000 per seat
            finalPremium = Math.max((vehicleValue * rate) + (validSeats * seatLoadingRate), minimumPremium);
        } else if (subType === 'bus_private') {
            rate = 0.05; // 5.0%
            seatLoadingRate = 10000; // TZS 10,000 per seat
            finalPremium = Math.max((vehicleValue * rate) + (validSeats * seatLoadingRate), minimumPremium);
        } else if (subType === 'bus_school') {
            rate = 0.05; // 5.0%
            seatLoadingRate = 7500; // TZS 7,500 per seat
            finalPremium = Math.max((vehicleValue * rate) + (validSeats * seatLoadingRate), minimumPremium);
        }
    }

    // --- 4. SPECIAL TYPE VEHICLES (Tractors, Cranes, Forklifts) ---
    else if (vehicleClass === 'special_type') {
        if (coverType === 'comprehensive') {
            rate = 0.02; // 2.0% base premium
            minimumPremium = 250000; // TZS 250,000 floor limit
            finalPremium = Math.max(vehicleValue * rate, minimumPremium);
        } else if (coverType === 'tpo') {
            finalPremium = 100000; // Flat Third Party Premium
        }
    }

    // Safety fallback for incorrect payload mappings
    if (finalPremium === 0) {
        return { success: false, message: "Invalid system mapping parameters." };
    }

    return {
        success: true,
        vehicleClass,
        subType: subType || 'none',
        coverType,
        sumInsured: vehicleValue,
        calculatedPremium: Math.round(finalPremium),
        currency: "TZS",
        legalDisclaimer: "Premium meets standard compliance rules of TIRA & Association of Tanzania Insurers."
    };
}

// System compilation export
if (typeof module !== 'undefined') {
    module.exports = { calculateTanzaniaMotorPremium };
}
