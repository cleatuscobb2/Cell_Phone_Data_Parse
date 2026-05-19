/**
 * CustodyIntake — the custody-filing case-profile questionnaire.
 *
 * Driven by a per-state `intake` config (see stateIntake.js): it renders that
 * state's questions and, as they are answered, shows the required form packet
 * its resolver computes. The answers are also sent to the backend so the
 * analysis is tailored to the filer's case.
 */

const FIELD =
  "mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

export default function CustodyIntake({ intake, answers, onChange }) {
  const set = (id, value) => {
    const next = { ...answers };
    if (value) next[id] = value;
    else delete next[id];
    onChange(next);
  };

  const { questions } = intake;
  const answered = questions.filter((q) => answers[q.id]).length;
  const forms = intake.requiredForms(answers);
  const complete = answered === questions.length;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {questions.map((q) => (
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
            Required {intake.formsLabel} form packet — {forms.length} form
            {forms.length === 1 ? "" : "s"}
            {!complete && (
              <span className="font-normal text-indigo-500">
                {" "}
                (answer all {questions.length} questions for the
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
          {intake.note && (
            <p className="mt-2 border-t border-indigo-200 pt-2 text-[11px] text-indigo-500">
              Note: {intake.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
