# Quickstart: validating 002

## Automated checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` must include: the 002 isolation suite (every route in contracts/api.md), real-database
tests for the exclusion constraint (double booking), idempotent payments and refunds under
concurrency, invoice totals and balances, day closing totals, and the clinical-gate tests.

## Run the demo

```bash
npm run dev
```

Demo data from 001 is extended with 002 data: two practitioners at Shifa Health Clinic (Gulberg and
DHA branches), a service list in PKR, a few patients with history, booked and walk-in appointments
for today, one issued invoice and one payment.

## Manual scenarios

1. **Find a patient (US1):** as the receptionist, search "Mohamad Ali" with a patient registered as
   "Muhammad Ali". Expect the record, with its number and masked phone.
2. **Register with duplicate check:** register the same name and phone. Expect the duplicate warning
   and the choice to confirm.
3. **History provenance (US2):** record an allergy by voice in English. Expect it labelled
   patient-reported with author and time; conditions show "patient reports none" only after you
   choose it.
4. **Booking (US3):** book a 15-minute slot for a practitioner. Try to book the same time in a
   second browser: one succeeds, the other sees "slot taken" with new slots.
5. **Queue:** check a patient in, issue a ticket, call, and complete. Every step shows who did it.
6. **Invoice and payment (US4):** invoice a consultation of PKR 1,500 and a dressing of PKR 500 with a
   10% discount. Pay PKR 1,000 in cash, then 800 by wallet. Refund 300 with the approver recorded.
   Close the day and check the totals (PKR 1,800 billed after discount, 1,500 paid, 300 refunded,
   1,200 net collected).
7. **Reminders:** tomorrow's list excludes a patient without WhatsApp consent. Press send, mark it
   sent, and press again: a warning appears.
8. **Limits:** a receptionist cannot open reports; finance cannot read clinical history.

## Expected outcomes

Spec success criteria SC-001 to SC-007 hold, and every automated check passes.
