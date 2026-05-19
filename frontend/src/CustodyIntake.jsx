/**
 * CustodyIntake — the WV custody-filing case-profile questionnaire.
 *
 * Renders the seven "Logic Path" questions and, as they are answered, shows
 * the required WV form packet computed by requiredForms(). The answers are
 * also sent to the backend so the analysis is tailored to the filer's case.
 */

import { INTAKE_QUESTIONS, requiredForms } from "./custodyForms.js";

const FIELD =
  "mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

export default function CustodyIntake({ answers, onChange }) {
  const set = (id, value) => {
    const next = { ...answers };
    if (value) next[id] = value;
    else delete next[id];
    onChange(next);
  };

  const answered = INTAKE_QUESTIONS.filter((q) => answers[q.id]).length;
  const forms = requiredForms(answers);
  const complete = answered === INTAKE_QUESTIONS.length;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {INTAKE_QUESTIONS.map((q) => (
          <label
            key={q.id}
            className="flex flex-col text-xs font-medium text-slate-600"
          >
            {q.question}
            <select
              value={answers[q.id] || ""}
              onChange={(e) => set(q.id, e.target.value)}
              className={FIELD}
            >
              <option value="">Select…</option>
              {q.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {answered > 0 && (
        <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-xs font-semibold text-indigo-800">
            Required WV form packet — {forms.length} form
            {forms.length === 1 ? "" : "s"}
            {!complete && (
              <span className="font-normal text-indigo-500">
                {" "}
                (answer all {INTAKE_QUESTIONS.length} questions for the
                complete packet)
              </span>
            )}
          </p>
          <ul className="mt-1.5 space-y-1">
            {forms.map((f) => (
              <li key={f.id} className="text-xs text-indigo-900">
                <span className="font-semibold">{f.number}</span> — {f.title}
                <span className="block text-indigo-500">{f.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-indigo-200 pt-2 text-[11px] text-indigo-500">
            Note: West Virginia&rsquo;s family-court (SCA-FC) forms are uniform
            statewide — the county you select determines the filing court and
            any local cover sheets or fees, not the form set itself.
          </p>
        </div>
      )}
    </div>
  );
}
