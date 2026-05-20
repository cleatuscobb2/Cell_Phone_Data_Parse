/**
 * CardLookup — small editor for a "last-4 of card → parent" mapping.
 *
 * The receipt extractor uses this mapping to resolve the payer from a
 * card last-4 visible on a receipt. We only ever capture the last 4
 * digits; full card numbers are never accepted.
 *
 * Returns an object via onChange:  { "4521": "mother", "8734": "father" }
 */

import { useState } from "react";

const FIELD =
  "rounded-md border border-slate-300 px-2 py-1 text-sm";

export default function CardLookup({ lookup, onChange }) {
  // Local editable list keeps each row's last-4 + parent independently
  // so adding a row doesn't immediately collapse incomplete entries.
  const [rows, setRows] = useState(() =>
    Object.entries(lookup || {}).map(([last4, parent]) => ({ last4, parent })),
  );

  function publish(next) {
    setRows(next);
    const map = {};
    for (const r of next) {
      const k = (r.last4 || "").replace(/\D/g, "").slice(-4);
      if (k.length === 4 && (r.parent === "mother" || r.parent === "father")) {
        map[k] = r.parent;
      }
    }
    onChange(map);
  }

  function updateRow(i, patch) {
    publish(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    publish([...rows, { last4: "", parent: "mother" }]);
  }

  function removeRow(i) {
    publish(rows.filter((_, j) => j !== i));
  }

  return (
    <div>
      <p className="text-xs text-slate-400">
        Only the last 4 digits — used to attribute a receipt to a parent.
        Full card numbers are never accepted and never stored.
      </p>
      {rows.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Card ending</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="4521"
                value={r.last4}
                onChange={(e) =>
                  updateRow(i, { last4: e.target.value.replace(/\D/g, "") })
                }
                className={`${FIELD} w-20 text-center`}
              />
              <span className="text-xs text-slate-500">belongs to</span>
              <select
                value={r.parent}
                onChange={(e) => updateRow(i, { parent: e.target.value })}
                className={FIELD}
              >
                <option value="mother">mother (me)</option>
                <option value="father">father (other parent)</option>
              </select>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-xs text-slate-400 hover:text-rose-600"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addRow}
        className="mt-2 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-indigo-300 hover:bg-slate-50"
      >
        + Add a card
      </button>
    </div>
  );
}
