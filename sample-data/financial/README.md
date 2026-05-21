# Sample financial inputs

Synthetic documents you can drop into the **Custody Analysis** form to
exercise the full financial pipeline end-to-end. Every file refers to the
Miller family (Sarah = mother, David = "Dave" = father, Emma & Liam =
children) — the same family the synthetic message data uses — so the
samples tell one coherent story.

## What's in each folder

| Folder | Drop into | Files |
|---|---|---|
| `receipts/` | **Receipts / bills** zone | 7 PDFs — pediatric dental, eye exam, summer camp, soccer registration, school supplies, driving lessons, orthodontics |
| `eobs/` | **Insurance EOBs** zone | 3 PDFs — BlueCross dental EOB (Sarah subscriber), Aetna pediatric office visit (Sarah subscriber), UnitedHealthcare orthodontic EOB (**David** subscriber) |
| `payment-apps/` | **Payment-app CSVs** zone | 4 CSVs — Venmo, Zelle, Cash App, PayPal (each format slightly different, all use 2024 dates) |
| `bank/` | **Bank / credit-card CSVs** zone | 2 CSVs — Chase checking, Capital One credit card |

## Card lookup to use with these samples

Add these two rows under **Card lookup** on the form so the extractor
resolves the payer on each receipt and bank/credit-card row:

| Card ending | Belongs to |
|---|---|
| `4521` | mother (Sarah) |
| `8734` | father (David) |

## What the samples are designed to show

- **Receipts** demonstrate the four court categories: medical/dental/eye, education, activities, motor-vehicle.
- **EOBs** demonstrate both possible policyholders — most are on Sarah's plan, but the UnitedHealthcare orthodontic EOB is on David's plan. The `payer_evidence` field should report the subscriber name in each case.
- **Payment-app CSVs** include both child-related rows (kept by the LLM) and unrelated noise (coffee, Lyft, Netflix). Each app uses its own column naming so the tolerant parser is exercised.
- **Bank CSVs** are statement-shaped — heavy on noise (grocery, gas, rent, subscriptions) — so the aggressive child-related filter prompt is exercised. Most rows on the credit-card CSV use Sarah's card (`4521`), with two on David's card (`8734`).

## Quick sanity check

A full run with all these inputs should produce roughly:

- **Receipts → ~7 Expense rows** (one per PDF; orthodontics is also covered by an EOB)
- **EOBs → ~8 Expense rows** (one per service line across three EOBs)
- **Payment-app CSVs → ~25 Expense rows** (most kept, a handful filtered)
- **Bank CSVs → ~15 Expense rows** (heavy filtering — only the child-related transactions survive)

## Regenerating the PDFs

```bash
cd sample-data/financial
pip install reportlab
python generate_pdfs.py
```

The CSVs are written by hand and don't need a generator.
