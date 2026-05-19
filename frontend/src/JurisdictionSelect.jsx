/**
 * JurisdictionSelect — cascading State -> County dropdowns backed by
 * counties.js. The county list is scoped to the chosen state, and picking a
 * county surfaces its FIPS code. This identifies the court whose evidence
 * requirements the package will need to satisfy.
 */

import { COUNTIES_BY_STATE, STATES } from "./counties.js";

const FIELD =
  "mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm " +
  "disabled:bg-slate-50 disabled:text-slate-400";

export default function JurisdictionSelect({
  state,
  county,
  onStateChange,
  onCountyChange,
}) {
  const counties = state ? COUNTIES_BY_STATE[state] || [] : [];
  const picked = counties.find((c) => c.county === county);

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col text-xs font-medium text-slate-600">
          State
          <select
            value={state}
            onChange={(e) => onStateChange(e.target.value)}
            className={FIELD}
          >
            <option value="">Select a state</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs font-medium text-slate-600">
          County
          <select
            value={county}
            onChange={(e) => onCountyChange(e.target.value)}
            disabled={!state}
            className={FIELD}
          >
            <option value="">
              {state ? "Select a county" : "Select a state first"}
            </option>
            {counties.map((c) => (
              <option key={c.fips_code} value={c.county}>
                {c.county}
              </option>
            ))}
          </select>
        </label>
      </div>
      {picked && (
        <p className="mt-2 rounded-md bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700">
          Jurisdiction: {picked.county} County, {state} &middot; FIPS{" "}
          {picked.fips_code}
        </p>
      )}
    </div>
  );
}
