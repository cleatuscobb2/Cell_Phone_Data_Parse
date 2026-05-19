/**
 * counties.js — U.S. counties by state, with FIPS codes.
 *
 * The data source behind the State -> County jurisdiction selector. The
 * selected county identifies the court whose evidence requirements the
 * package must satisfy.
 *
 * Each state key acts as a "tab". Start with West Virginia; add another
 * state by adding its key with the same { county, fips_code } row shape.
 * FIPS codes are stored as strings so leading zeros (e.g. Alabama's
 * "01001") are preserved.
 */

export const COUNTIES_BY_STATE = {
  "West Virginia": [
    { county: "Barbour", fips_code: "54001" },
    { county: "Berkeley", fips_code: "54003" },
    { county: "Boone", fips_code: "54005" },
    { county: "Braxton", fips_code: "54007" },
    { county: "Brooke", fips_code: "54009" },
    { county: "Cabell", fips_code: "54011" },
    { county: "Calhoun", fips_code: "54013" },
    { county: "Clay", fips_code: "54015" },
    { county: "Doddridge", fips_code: "54017" },
    { county: "Fayette", fips_code: "54019" },
    { county: "Gilmer", fips_code: "54021" },
    { county: "Grant", fips_code: "54023" },
    { county: "Greenbrier", fips_code: "54025" },
    { county: "Hampshire", fips_code: "54027" },
    { county: "Hancock", fips_code: "54029" },
    { county: "Hardy", fips_code: "54031" },
    { county: "Harrison", fips_code: "54033" },
    { county: "Jackson", fips_code: "54035" },
    { county: "Jefferson", fips_code: "54037" },
    { county: "Kanawha", fips_code: "54039" },
    { county: "Lewis", fips_code: "54041" },
    { county: "Lincoln", fips_code: "54043" },
    { county: "Logan", fips_code: "54045" },
    { county: "McDowell", fips_code: "54047" },
    { county: "Marion", fips_code: "54049" },
    { county: "Marshall", fips_code: "54051" },
    { county: "Mason", fips_code: "54053" },
    { county: "Mercer", fips_code: "54055" },
    { county: "Mineral", fips_code: "54057" },
    { county: "Mingo", fips_code: "54059" },
    { county: "Monongalia", fips_code: "54061" },
    { county: "Monroe", fips_code: "54063" },
    { county: "Morgan", fips_code: "54065" },
    { county: "Nicholas", fips_code: "54067" },
    { county: "Ohio", fips_code: "54069" },
    { county: "Pendleton", fips_code: "54071" },
    { county: "Pleasants", fips_code: "54073" },
    { county: "Pocahontas", fips_code: "54075" },
    { county: "Preston", fips_code: "54077" },
    { county: "Putnam", fips_code: "54079" },
    { county: "Raleigh", fips_code: "54081" },
    { county: "Randolph", fips_code: "54083" },
    { county: "Ritchie", fips_code: "54085" },
    { county: "Roane", fips_code: "54087" },
    { county: "Summers", fips_code: "54089" },
    { county: "Taylor", fips_code: "54091" },
    { county: "Tucker", fips_code: "54093" },
    { county: "Tyler", fips_code: "54095" },
    { county: "Upshur", fips_code: "54097" },
    { county: "Wayne", fips_code: "54099" },
    { county: "Webster", fips_code: "54101" },
    { county: "Wetzel", fips_code: "54103" },
    { county: "Wirt", fips_code: "54105" },
    { county: "Wood", fips_code: "54107" },
    { county: "Wyoming", fips_code: "54109" },
  ],
};

/** State names that currently have county data — for the state dropdown. */
export const STATES = Object.keys(COUNTIES_BY_STATE);
