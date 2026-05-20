/**
 * FinancialUpload — twin multi-file drop zones for receipts and
 * payment-app CSVs.
 *
 *   receipts  → JPEG / PNG / WebP / GIF images of bills, invoices, receipts
 *   csvs      → Venmo / Zelle / Cash App / PayPal transaction exports
 *
 * Each zone returns its current File[] array through its own callback.
 * Adding files appends; the "remove" buttons let the user prune.
 */

import { useRef, useState } from "react";

const RECEIPT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf";
const CSV_ACCEPT = ".csv,text/csv";

function MultiDropZone({ label, hint, accept, files, onChange }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function append(picked) {
    const arr = Array.from(picked || []);
    if (arr.length === 0) return;
    onChange([...files, ...arr]);
  }

  function remove(i) {
    onChange(files.filter((_, j) => j !== i));
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          append(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 text-center transition ${
          dragOver
            ? "border-emerald-400 bg-emerald-50"
            : "border-slate-300 hover:border-emerald-300 hover:bg-slate-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            append(e.target.files);
            // Allow re-selecting the same filename later.
            e.target.value = "";
          }}
        />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-medium text-slate-700">{hint}</p>
        <p className="text-xs text-slate-400">drag & drop or click — multiple OK</p>
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700"
            >
              <span className="truncate" title={f.name}>{f.name}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="ml-2 text-slate-400 hover:text-rose-600"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FinancialUpload({
  receipts,
  paymentCsvs,
  onReceiptsChange,
  onPaymentCsvsChange,
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <MultiDropZone
        label="Receipts / bills"
        hint="Images or PDFs"
        accept={RECEIPT_ACCEPT}
        files={receipts}
        onChange={onReceiptsChange}
      />
      <MultiDropZone
        label="Payment-app CSVs"
        hint="Venmo / Zelle / Cash App / PayPal"
        accept={CSV_ACCEPT}
        files={paymentCsvs}
        onChange={onPaymentCsvsChange}
      />
    </div>
  );
}
