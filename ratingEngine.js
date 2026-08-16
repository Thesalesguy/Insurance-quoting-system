/**
 * Fully Compliant Tanzania Actuarial Motor Rating Engine
 * Incorporates every detail from pages 1 to 4 of the official ATI/TIRA guidelines.
 * Currency: Tanzanian Shilling (TZS)
 */
function calculateTIRAComprehensiveMotorPremium(inputData) {
    const {
        vehicleClass,        // 'private_car', 'motorcycle', 'three_wheeler', 'commercial_goods_own', 'commercial_goods_general', 'passenger_carrying', 'special_type', 'trailer_standard', 'trailer_conversion', 'oil_tanker_steel', 'oil_tanker_aluminum', 'oil_tanker_over_10y'
        coverType,           // 'comprehensive', 'tpft', 'tpo'
        vehicleValue,        // Sum Insured (TZS)
        hasClaimRecord,      // Boolean: true if they have a history of claims
        carryingPassengers,  // Boolean: for motorcycles/three-wheelers (Bodaboda/Bajaj)
        tonnage,             // Number: for commercial goods TPO classification
        seatsCount,          // Number: for passenger carrying seat loading calculations
        isTatoaTaboaMember,  // Boolean: 5% association discount eligibility
        isEligibleFleet,     // Boolean: 20% fleet discount over 50 vehicles with CR <= 45%
        subType,             // Added: passenger sub-type (taxi_tour, daladala, bus_up_country, bus_private, bus_school)
        
        // Add-on Covers & Extensions (Page 3 & 4)
        addonExcessBuyBack,  // Boolean: 10% loading on the Own Damage (OD) premium
        addonLossOfUse,      // Boolean: Flat TZS 50,000 premium (Private Cars Only)
        addonGeographical,   // Boolean: 5% loading on the OD premium for beyond East Africa
        addonIncreasedTPPD,  // Number: Amount in TZS opted IN EXCESS of the base TZS 50 Million limit
        addonCarTracker      // Boolean: 5% reduction on total premium if a tracking device is installed
    } = inputData;

    let baseRate = 0;
    let minPremium = 0;
    let seatLoadingRate = 0;
    let seatTPORate = 0;
    let finalPremium = 0;
    let comments = [];

    const sumInsured = vehicleValue || 0;

    // ==========================================
    // 1. BASE PREMIUM & RATE MAPPING (Pages 1-3)
    // ==========================================
    
    // --- PRIVATE CARS (Page 1) ---
    if (vehicleClass === 'private_car') {
        if (coverType === 'comprehensive') {
            baseRate = hasClaimRecord ? 0.040 : 0.035; // 4% with claim record / 3.5% claims free
            minPremium = 250000;
            finalPremium = Math.max(sumInsured * baseRate, minPremium);
        } else if (coverType === 'tpft') {
            baseRate = 0.020; // 2% plus TPP
            minPremium = 200000;
            finalPremium = Math.max((sumInsured * baseRate) + 100000, minPremium); // Adds standard TPO baseline
        } else if (coverType === 'tpo') {
            finalPremium = 100000;
        }
    }

    // --- MOTORCYCLES & THREE WHEELERS (Page 1) ---
    else if (vehicleClass === 'motorcycle') {
        if (coverType === 'comprehensive') {
            baseRate = hasClaimRecord ? 0.060 : 0.050; // 6% with claim record / 5% claims free
            finalPremium = sumInsured * baseRate;
            if (carryingPassengers) { finalPremium += 15000; comments.push("Added TZS 15,000 Bodaboda loading"); }
        } else if (coverType === 'tpft') {
            // 3.5% plus TPP, min TZS 100,000
            finalPremium = Math.max((sumInsured * 0.035) + 50000, 100000);
        } else if (coverType === 'tpo') {
            finalPremium = 50000;
            if (carryingPassengers) { finalPremium += 15000; comments.push("Added TZS 15,000 Bodaboda loading to TPO"); }
        }
    }
    else if (vehicleClass === 'three_wheeler') {
        if (coverType === 'comprehensive') {
            baseRate = hasClaimRecord ? 0.070 : 0.060; // 7% with claim record / 6% claims free
            minPremium = 125000;
            finalPremium = Math.max(sumInsured * baseRate, minPremium);
            if (carryingPassengers) { finalPremium += 45000; comments.push("Added TZS 45,000 passenger loading"); }
        } else if (coverType === 'tpft') {
            finalPremium = Math.max((sumInsured * 0.035) + 75000, 100000);
        } else if (coverType === 'tpo') {
            finalPremium = 75000;
            if (carryingPassengers) { finalPremium += 45000; comments.push("Added TZS 45,000 passenger loading to TPO"); }
        }
    }

    // --- COMMERCIAL VEHICLES: GENERAL GOODS & GENERAL CARTAGE (Page 1-2) ---
    else if (vehicleClass === 'commercial_goods_own') {
        if (coverType === 'comprehensive') {
            baseRate = hasClaimRecord ? 0.0475 : 0.0425; // 4.75% vs 4.25%
            minPremium = 500000;
            finalPremium = Math.max(sumInsured * baseRate, minPremium);
        } else if (coverType === 'tpft') {
            finalPremium = Math.max((sumInsured * 0.025) + 150000, 350000); // 2.5% plus baseline TPO
        } else if (coverType === 'tpo') {
            if ((tonnage || 0) <= 2) finalPremium = 150000;
            else if (tonnage <= 5) finalPremium = 200000;
            else if (tonnage <= 10) finalPremium = 250000;
            else finalPremium = 300000;
        }
    }
    else if (vehicleClass === 'commercial_goods_general') {
        if (coverType === 'comprehensive') {
            baseRate = hasClaimRecord ? 0.0575 : 0.050; // 5.75% vs 5.0%
            minPremium = 500000;
            finalPremium = Math.max(sumInsured * baseRate, minPremium);
        } else if (coverType === 'tpft') {
            finalPremium = Math.max((sumInsured * 0.030) + 150000, 350000); // 3% plus baseline TPO
        } else if (coverType === 'tpo') {
            if ((tonnage || 0) <= 2) finalPremium = 150000;
            else if (tonnage <= 5) finalPremium = 200000;
            else if (tonnage <= 10) finalPremium = 250000;
            else finalPremium = 300000;
        }
    }

    // --- TRAILERS (Page 2) ---
    else if (vehicleClass === 'trailer_standard') {
        if (coverType === 'comprehensive') {
            baseRate = hasClaimRecord ? 0.0475 : 0.040;
            finalPremium = sumInsured * baseRate;
        } else if (coverType === 'tpo') { finalPremium = 100000; }
    }
    else if (vehicleClass === 'trailer_conversion') {
        if (coverType === 'comprehensive') {
            baseRate = hasClaimRecord ? 0.0575 : 0.0525;
            finalPremium = sumInsured * baseRate;
        } else if (coverType === 'tpo') { finalPremium = 100000; }
    }

    // --- OIL TANKERS (Page 2) ---
    else if (vehicleClass === 'oil_tanker_steel') {
        if (coverType === 'comprehensive') { finalPremium = Math.max(sumInsured * 0.06, 2000000); }
        else if (coverType === 'tpft') { finalPremium = Math.max((sumInsured * 0.04) + 750000, 1500000); }
        else if (coverType === 'tpo') { finalPremium = 750000; }
    }
    else if (vehicleClass === 'oil_tanker_aluminum') {
        if (coverType === 'comprehensive') { finalPremium = Math.max(sumInsured * 0.07, 2000000); }
        else if (coverType === 'tpft') { finalPremium = Math.max((sumInsured * 0.04) + 750000, 1500000); }
        else if (coverType === 'tpo') { finalPremium = 750000; }
    }
    else if (vehicleClass === 'oil_tanker_over_10y') {
        if (coverType === 'comprehensive') { finalPremium = Math.max(sumInsured * 0.08, 2000000); }
        else if (coverType === 'tpft') { finalPremium = Math.max((sumInsured * 0.04) + 750000, 1500000); }
        else if (coverType === 'tpo') { finalPremium = 750000; }
    }

    // --- PASSENGER CARRYING VEHICLES: TAXIS, DALADALAS & BUSES (Page 2-3) ---
    else if (vehicleClass === 'passenger_carrying') {
        const seats = seatsCount || 0;
        if (coverType === 'comprehensive') {
            minPremium = 500000;
            if (subType === 'taxi_tour') {
                baseRate = hasClaimRecord ? 0.060 : 0.055;
                seatLoadingRate = hasClaimRecord ? 0 : 15000; // TZS 15,000 if no claim record
                finalPremium = Math.max((sumInsured * baseRate) + (seats * seatLoadingRate), minPremium);
            } else if (subType === 'daladala') {
                finalPremium = Math.max((sumInsured * 0.080) + (seats * 15000), 2000000); // Page 3 structural floor
            } else if (subType === 'bus_up_country') {
                finalPremium = Math.max((sumInsured * 0.080) + (seats * 30000), 2000000);
            } else if (subType === 'bus_private') {
                finalPremium = Math.max((sumInsured * 0.050) + (seats * 10000), 2000000);
            } else if (subType === 'bus_school') {
                finalPremium = Math.max((sumInsured * 0.050) + (seats * 7500), 2000000);
            }
        } else if (coverType === 'tpo') {
            if (subType === 'taxi_tour') seatTPORate = 15000;
            else if (subType === 'daladala') seatTPORate = 15000;
            else if (subType === 'bus_up_country') seatTPORate = 30000;
            else if (subType === 'bus_private') seatTPORate = 10000;
            else if (subType === 'bus_school') seatTPORate = 7500;
            finalPremium = Math.max(seats * seatTPORate, 150000); // Page 3 flat TPO floor rule
        }
    }

    // --- SPECIAL TYPE VEHICLES (Page 3) ---
    else if (vehicleClass === 'special_type') {
        if (coverType === 'comprehensive') {
            finalPremium = Math.max(sumInsured * 0.020, 250000);
        } else if (coverType === 'tpo') {
            finalPremium = 100000;
        }
    }

    // ==========================================
    // 2. OWN DAMAGE (OD) PREMIUM SEPARATION FOR RIDER CALCULATIONS
    // ==========================================
    // Actuarial rule: Loadings for extensions apply strictly to the Own Damage component.
    // We isolate the OD component by deducting the standard Third Party baseline premium.
    const implicitThirdPartyBaseline = 100000; 
    let ownDamagePremium = Math.max(0, finalPremium - implicitThirdPartyBaseline);

    // ==========================================
    // 3. ADD-ON COVERS & CONDITIONS LOADING (Page 3-4)
    // ==========================================
    let addonPremiumTotal = 0;

    // Add-on 1: Excess Buy-back (10% loading on OD premium)
    if (addonExcessBuyBack && coverType === 'comprehensive') {
        let loading = ownDamagePremium * 0.10;
        addonPremiumTotal += loading;
        comments.push(`Excess Buy-back rider loaded: +TZS ${Math.round(loading)}`);
    }

    // Add-on 2: Loss of Use (Private Cars Only: Max 21 days @ 50,000/day = Flat 50,000 premium)
    if (addonLossOfUse && vehicleClass === 'private_car' && coverType === 'comprehensive') {
        addonPremiumTotal += 50000;
        comments.push("Loss of Use extension applied: +TZS 50,000");
    }

    // Add-on 3: Geographical Extension beyond East Africa (5% loading on OD premium)
    if (addonGeographical && coverType === 'comprehensive') {
        let loading = ownDamagePremium * 0.05;
        addonPremiumTotal += loading;
        comments.push(`COMESA/Geographical Extension loaded: +TZS ${Math.round(loading)}`);
    }

    // Add-on 4: Increased Third Party Property Damage (TPPD) Limit (> TZS 50 Million base)
    if (addonIncreasedTPPD > 0) {
        let extraLimitLoading = addonIncreasedTPPD * 0.005; // 0.5% rate on increased limit tier
        addonPremiumTotal += extraLimitLoading;
        comments.push(`Increased TPPD Limit structural premium: +TZS ${Math.round(extraLimitLoading)}`);
    }

    finalPremium += addonPremiumTotal;

    // ==========================================
    // 4. STATUTORY ASSOCIATION & FLEET DISCOUNTS
    // ==========================================
    let discountAmount = 0;

    // Association Member Discount (TATOA / TABOA: 5% subject to approval)
    if (isTatoaTaboaMember) {
        let disc = finalPremium * 0.05;
        discountAmount += disc;
        comments.push(`Applied 5% TATOA/TABOA member discount: -TZS ${Math.round(disc)}`);
    }

    // Fleet Rating Discount Rules (Fleet > 50 vehicles, comprehensive ratio <= 45%: 20% discount)
    if (isEligibleFleet) {
        let disc = finalPremium * 0.20;
        discountAmount += disc;
        comments.push(`Applied 20% Certified Actuarial Fleet Rating Discount: -TZS ${Math.round(disc)}`);
    }

    // Add-on 5: Verified Car Tracking Device (5% reduction deduction)
    if (addonCarTracker) {
        let disc = finalPremium * 0.05;
        discountAmount += disc;
        comments.push(`Applied 5% Tracking Device Installation discount: -TZS ${Math.round(disc)}`);
    }

    finalPremium = Math.max(0, finalPremium - discountAmount);

    // ==========================================
    // 5. STANDARD EXCESS MANDATES LOG
    // ==========================================
    let excessMandateSummary = "Standard deductible applies.";

    if (vehicleClass === 'private_car') {
        excessMandateSummary = "5% of Claim, Min TZS 350,000 (Doubled in case of Total Theft).";
    } else if (vehicleClass === 'motorcycle' || vehicleClass === 'three_wheeler') {
        excessMandateSummary = "5% of Claim, Min TZS 100,000 (Doubled in case of Total Theft).";
    } else if (vehicleClass && vehicleClass.startsWith('commercial_goods')) {
        excessMandateSummary = "7.5% of Claim, Min TZS 500,000 (10% of Claim, Min TZS 750,000 for total theft).";
    } else if (vehicleClass === 'special_type') {
        excessMandateSummary = "10% of Claim, Minimum TZS 1,000,000 per claim.";
    }

    // ==========================================
    // 6. FINAL COMPLIANCE AND RETURN OBJECT
    // ==========================================
    return {
        success: true,
        summary: {
            calculatedBasePremium: Math.round(finalPremium + discountAmount - addonPremiumTotal),
            totalAddonLoadings: Math.round(addonPremiumTotal),
            totalDiscountsDeducted: Math.round(discountAmount),
            payablePremiumTZS: Math.round(finalPremium)
        },
        complianceDetails: {
            currency: "TZS",
            excessMandateRule: excessMandateSummary,
            antiMoneyLaunderingRequirement: "Warranted: Proposal form must be counter-signed by a licensed broker under TIRA AML/CFT regulations.",
            systemLogs: comments
        }
    };
}

// Module Export for Node/Repository structure Integration
if (typeof module !== 'undefined' && module.exports) {
    // Export the actual function name that exists in this file.
    module.exports = { calculateTIRAComprehensiveMotorPremium };
}