/**
 * custodyForms.js — West Virginia family-court custody filing forms and the
 * logic that determines which forms a filer needs.
 *
 * Source data: the "WV Documents Custody Dataset" (the 15 forms) and the
 * "Logic Path for Custody Forms Required" decision tree (the 7 questions
 * and the answer -> form mapping).
 *
 * INTAKE_QUESTIONS drives the case-profile questionnaire in the app;
 * requiredForms() maps a set of answers to the exact form packet.
 */

// The WV family-court forms, keyed by an internal id.
export const WV_CUSTODY_FORMS = {
  initial_petition_form: {
    number: "SCA-FC-261",
    title: "Petition for Support and/or Allocation of Custodial Responsibility",
    purpose: "Starts a stand-alone custody/support case.",
  },
  initial_petition_form_modification: {
    number: "SCA-FC-201",
    title: "Petition for Modification",
    purpose: "Modifies an existing custody/support order.",
  },
  case_information_form: {
    number: "SCA-FC-103",
    title: "Petitioner's Civil Case Information Statement (Domestic Relations)",
    purpose: "The civil case information statement required for all filings.",
  },
  financial_disclosure_form: {
    number: "SCA-FC-106",
    title: "Financial Statement",
    purpose: "Financial disclosure, especially where support is involved.",
  },
  parenting_plan_form: {
    number: "SCA-FC-121",
    title: "Parenting Plan",
    purpose: "Sets the parenting schedule, decision-making, and custodial terms.",
  },
  parenting_plan_worksheet: {
    number: "SCA-FC-128",
    title: "Worksheet for Individual Proposed Parenting Plan",
    purpose: "Worksheet used to prepare the proposed parenting plan.",
  },
  temporary_relief_form: {
    number: "SCA-FC-112",
    title: "Motion for Temporary Relief",
    purpose: "Requests temporary support/custody orders while the case is pending.",
  },
  child_support_enforcement_form: {
    number: "FDVCSAP",
    title: "BCSE Application and Income Withholding Form",
    purpose: "Used when child support enforcement or income withholding is needed.",
  },
  service_acceptance_form: {
    number: "SCA-FC-105",
    title: "Acceptance of Service",
    purpose: "Used if the other parent voluntarily accepts the papers.",
  },
  publication_or_unknown_address_form: {
    number: "SCA-FC-110",
    title: "Affidavit of Out-of-State or Unknown Residency",
    purpose: "Used if the other parent's address is unknown or out of state.",
  },
  publication_order_form: {
    number: "SCA-FC-111",
    title: "Order of Publication",
    purpose: "Used when personal service fails and publication is needed.",
  },
  service_certificate_form: {
    number: "SCA-FC-314",
    title: "Certificate of Service",
    purpose: "Used for filings served on the other side after the petition.",
  },
  address_confidentiality_form: {
    number: "SCA-FC-140",
    title: "Affidavit to Withhold Identifying Information",
    purpose: "Used when disclosing your address would risk safety or health.",
  },
  hearing_notice_form: {
    number: "Notice of Hearing",
    title: "Notice of Hearing",
    purpose: "Filed later if the court directs a party to notice a hearing.",
  },
  military_waiver_form: {
    number: "SCA-FC-115",
    title: "SCRA Waiver (Servicemembers Civil Relief Act)",
    purpose: "Relevant when active-duty military protections may apply.",
  },
};

// The case-profile questions — the "Logic Path" decision tree, in order.
export const INTAKE_QUESTIONS = [
  {
    id: "marital_status",
    question: "Are the parents currently married to each other?",
    options: [
      { value: "married", label: "Yes — married (custody within a divorce)" },
      { value: "unmarried", label: "No / already divorced (stand-alone case)" },
    ],
  },
  {
    id: "case_type",
    question: "Is this a new case or a modification of an existing order?",
    options: [
      { value: "new", label: "A new custody / support case" },
      { value: "modification", label: "A modification of an existing order" },
    ],
  },
  {
    id: "temporary_relief",
    question: "Do you need temporary orders while the case is pending?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "child_support",
    question: "Is child support establishment or enforcement involved?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "address_safety",
    question:
      "Would revealing your address or contact information endanger your safety or health?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "other_parent_address",
    question: "Do you know the other parent's current address or location?",
    options: [
      { value: "known", label: "Known — they will likely accept service" },
      { value: "unknown", label: "Unknown / out of state — may need publication" },
    ],
  },
  {
    id: "military",
    question: "Is the other parent on active military duty?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
];

/**
 * Map a set of intake answers to the required WV form packet, following the
 * Logic Path decision tree. Returns an ordered list of
 * { id, number, title, purpose, reason } — `reason` is why the form applies.
 */
export function requiredForms(answers = {}) {
  const out = [];
  const add = (id, reason) => out.push({ id, ...WV_CUSTODY_FORMS[id], reason });

  // Initial petition — new case vs. modification of an existing order.
  if (answers.case_type === "modification") {
    add("initial_petition_form_modification", "Modifying an existing order.");
  } else if (answers.case_type === "new") {
    add("initial_petition_form", "Starting a new custody/support case.");
  }

  // Core forms — required in every WV custody filing.
  add("case_information_form", "Required in every WV custody filing.");
  add("financial_disclosure_form", "Required in every WV custody filing.");
  add("parenting_plan_form", "Required in every WV custody filing.");
  add("parenting_plan_worksheet", "Required in every WV custody filing.");

  // Conditional forms driven by the intake answers.
  if (answers.temporary_relief === "yes") {
    add("temporary_relief_form", "You need temporary orders while the case is pending.");
  }
  if (answers.child_support === "yes") {
    add(
      "child_support_enforcement_form",
      "Child support establishment or enforcement is involved.",
    );
  }
  if (answers.address_safety === "yes") {
    add(
      "address_confidentiality_form",
      "Revealing your address could endanger your safety.",
    );
  }
  if (answers.other_parent_address === "known") {
    add("service_acceptance_form", "The other parent can accept service directly.");
  } else if (answers.other_parent_address === "unknown") {
    add(
      "publication_or_unknown_address_form",
      "The other parent's address is unknown or out of state.",
    );
    add("publication_order_form", "Personal service may not be possible — publication may be required.");
  }
  if (answers.military === "yes") {
    add("military_waiver_form", "The other parent is on active military duty.");
  }

  // Always part of the packet, for documents served after the petition.
  add("service_certificate_form", "Needed for documents served after the petition.");

  return out;
}

/** Forms the court may direct a party to file later in the case. */
export const LATER_FORMS = ["hearing_notice_form"];

/** Display labels for the report's evidence sections. */
export const EVIDENCE_LABELS = {
  overview: "Overview",
  childcare: "Childcare instances",
  missed: "Missed & cancelled visits",
  gaps: "Communication gaps",
  responsibilities: "Parenting responsibilities",
  thirdparty: "Third-party statements",
};

/**
 * Which report evidence sections help complete which form — lets the report
 * map the gathered evidence to the form(s) it supports. Administrative forms
 * (service, address, military) are evidence-neutral and are omitted here.
 */
export const FORM_EVIDENCE = {
  initial_petition_form: ["overview", "childcare", "missed", "gaps"],
  initial_petition_form_modification: ["overview", "childcare", "missed", "gaps"],
  financial_disclosure_form: ["responsibilities"],
  parenting_plan_form: ["childcare", "responsibilities", "missed"],
  parenting_plan_worksheet: ["childcare", "responsibilities"],
  temporary_relief_form: ["missed", "gaps", "childcare"],
  child_support_enforcement_form: ["responsibilities"],
};

/** Build a plain-language case-profile summary for prompts / display. */
export function caseProfileSentences(answers = {}) {
  const s = [];
  if (answers.marital_status === "married")
    s.push("The parents are currently married (custody within a divorce).");
  if (answers.marital_status === "unmarried")
    s.push("The parents are not married or are already divorced (stand-alone custody case).");
  if (answers.case_type === "new") s.push("This is a new custody/support case.");
  if (answers.case_type === "modification")
    s.push("This is a modification of an existing custody order.");
  if (answers.temporary_relief === "yes")
    s.push("Temporary orders are being requested while the case is pending.");
  if (answers.child_support === "yes")
    s.push("Child support establishment or enforcement is involved.");
  if (answers.address_safety === "yes")
    s.push("Disclosing the filer's address could endanger their safety.");
  if (answers.other_parent_address === "unknown")
    s.push("The other parent's address is unknown or out of state.");
  if (answers.military === "yes")
    s.push("The other parent is on active military duty.");
  return s;
}
