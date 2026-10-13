# 0004: Money as whole Pakistani rupees

Status: accepted · 14 October 2026

## Decision

- Currency: Pakistani rupee only in the MVP.
- Amounts are stored as whole rupees in integer columns. No floating point is used for money anywhere.
- Percentage discounts are converted to whole rupees by rounding half up, once, when the invoice line or invoice is saved.
- An invoice total is the sum of its line amounts minus the discount, and is never below zero.
- Payments cannot exceed the amount still due. Overpayment is rejected.
- Invoice status is derived from totals: unpaid, partial or paid. A voided invoice keeps its payments for the record and is excluded from dues and daily totals.

## Why

Paisa-level amounts are not used in clinic fees, and integers remove rounding drift. Rules are written down so reports and invoices always agree.

## Consequences

- If another currency or paisa precision is needed, add a currency column and store minor units. That needs a migration of existing amounts.
