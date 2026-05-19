/**
 * stateIntake.js — the per-state custody-intake registry.
 *
 * Each state that has a custody-filing intake registers an entry here. The
 * UI shows the intake questionnaire only for the selected state, and pulls
 * its questions, form-packet resolver, and surrounding copy from this entry.
 *
 * To add a state: add its key with the same shape. West Virginia's intake
 * lives in custodyForms.js (its "Logic Path" questions and SCA-FC forms);
 * a future state would have its own questions/requiredForms module wired in
 * the same way.
 */

import { INTAKE_QUESTIONS, requiredForms } from "./custodyForms.js";

export const STATE_INTAKE = {
  "West Virginia": {
    label: "WV custody filing intake",
    blurb:
      "Answer these to determine the exact West Virginia form packet your " +
      "case requires and to tailor the analysis to it.",
    questions: INTAKE_QUESTIONS,
    requiredForms,
    formsLabel: "WV",
    note:
      "West Virginia’s family-court (SCA-FC) forms are uniform " +
      "statewide — the county you select determines the filing court " +
      "and any local cover sheets or fees, not the form set itself.",
  },
};

/** The intake config for a state, or null if that state has no intake yet. */
export function getStateIntake(state) {
  return STATE_INTAKE[state] || null;
}
