# Clinic Management Platform: Business Document

Version 0.1 · 14 October 2026 · Draft for discussion

Every number marked as a hypothesis is a guess to test in customer interviews. Market facts come from vendor pages and search summaries checked on 13 October 2026, and not every page was opened in full.

---

## 1. Summary

We will build a multi-tenant clinic management system for small private clinics in Pakistan, sell it directly, and later extend the same core to labs, pharmacies and small hospitals.

The bet is that the market lacks adoption, not products. Many local vendors already sell clinic, dental, lab and hospital software at roughly Rs 1,500 to Rs 9,000 a month. We win on direct selling, free data migration, a start measured in hours, and a WhatsApp-first workflow, not on a longer feature list.

Revenue hypothesis: 100 clinics at about Rs 5,000 a month would bring in Rs 500,000 a month. This is unproven.

## 2. Founder context and constraints

- Solo founder with development skills and a willingness to do direct sales.
- Side income, so the business must be run by one person with low support load.
- No tax or kids products, and a preference for business customers over consumers, to keep legal effort low.
- Existing technical base: a NestJS and Nuxt 3 codebase from an earlier project, to reuse as a pattern, not as a product.

## 3. The problem

Assumed, to confirm in interviews:

- Patient history sits in paper registers, so repeat visits cost time and tests may be repeated.
- Appointments, queues and reminders run through calls and hand-typed WhatsApp messages.
- Billing, dues and daily cash are reconciled by hand at closing time.
- Lab and pharmacy stock, where a clinic has them, is tracked separately or not at all.

Supporting evidence: [research on Pakistan's health system](https://pubmed.ncbi.nlm.nih.gov/42152212/) describes records as largely paper-based and fragmented. Vendor blogs report that about 90% of small shops still keep manual records, though that figure is about shops, not clinics.

## 4. Market and competitors

Competitors seen in Pakistan:

| Segment | Vendors found | Price seen |
| --- | --- | --- |
| Small clinics | [e-Mareez](https://e-mareez.com/products/clinicmanagement) | From Rs 1,500 a month |
| Dental clinics | [Denzif](https://denzif.com/), [jDent](https://jdentclinic.com/), [DentaCare](https://www.dentacare.app/), [YourSmile](https://yoursmilehq.com/) | Rs 1,500 to Rs 8,000 a month |
| Hospitals | [Delloweb](https://delloweb.com.pk/hospital-management-system-hms/), [Paksoftware](https://paksoftware.pk/hospitalsystem.php), [Lifeline HMS](https://lifelinehms.com/hms) | Rs 9,000 a month, or Rs 75,000 once plus Rs 8,000 a month |
| Labs | [PathCare](https://www.pathcaresoft.com/) with 300+ labs, [NextLab](https://nextlab.com.pk/), [PMS](https://pmsapp.cloud/best-medical-lab-software-pakistan) | From Rs 2,000 a month |
| Marketplaces | [Marham](https://pk.linkedin.com/company/marham) with 5,000+ hospitals listed | Not checked |

What this tells us:

- A good cloud system for a dental clinic is quoted at Rs 4,000 to Rs 10,000 a month. That is our price benchmark.
- Local vendors compete on low prices. We should not compete at Rs 1,500.
- The vendor summaries reviewed did not mention free migration from paper or a quick start. Confirm by trying their demos.
- Marham could become a partner or a competitor. Check early.

## 5. Customers

Buyer at launch: the owner of a private clinic with one to five doctors. Daily users: the doctor and the receptionist.

| Role | Need | Success looks like |
| --- | --- | --- |
| Clinic owner | Fewer lost patients and dues, daily income view | Sees daily cash and dues on one screen |
| Doctor | Fast access to history, quick prescriptions | A prescription written and sent in under a minute |
| Receptionist | Booking, queue, billing, reminders without double entry | Runs the whole day from one screen and WhatsApp |

Not targeted at first: government facilities and large hospitals, which buy slowly and ask for custom work.

## 6. Offer

- Appointments, patient history, prescriptions, billing and WhatsApp reminders.
- Urdu and English screens, with Roman Urdu search.
- Free import of the patient list from a spreadsheet or typed register.
- Live within one working day, with one hour of receptionist training.
- WhatsApp support line.
- Later modules, switched on per clinic: lab, pharmacy, then inpatient and theatre.

## 7. Pricing hypotheses

| Plan | Includes | Price a month, to test |
| --- | --- | --- |
| Starter | One doctor, appointments, records, prescriptions, billing | Rs 3,000 |
| Clinic | Up to five doctors, WhatsApp reminders, reports, data import | Rs 5,000 |
| Clinic plus | Lab and pharmacy modules, panel billing | Rs 8,000 |
| Hospital | Inpatient and theatre | Set after the first hospital pilot |

Payments: JazzCash and Easypaisa wallets do not support automatic recurring charges, so each payment is manual. Offer annual prepay at a discount and record payments in the product. See [JazzCash vs Easypaisa for SaaS](https://itslift.com/insights/jazzcash-vs-easypaisa-payment-integration).

## 8. Revenue scenarios

Arithmetic on the price hypotheses, before costs and payment losses:

| Paying clinics | At Rs 3,000 | At Rs 5,000 | At Rs 8,000 |
| --- | --- | --- | --- |
| 10 | Rs 30,000 | Rs 50,000 | Rs 80,000 |
| 30 | Rs 90,000 | Rs 150,000 | Rs 240,000 |
| 100 | Rs 300,000 | Rs 500,000 | Rs 800,000 |

Costs are not yet estimated. Items to price: hosting, backups, WhatsApp messages, a messaging provider, domain and email, and any helper for sales or support.

## 9. Go-to-market

1. Pick one city. Visit clinics in person with a working demo on a phone.
2. Offer free setup and data entry to the first 10 clinics in exchange for a paid commitment and a testimonial.
3. Ask each happy clinic for two referrals.
4. Approach nearby labs and pharmacies, since they sit next to clinics.
5. Check whether Marham or similar platforms would partner.

## 10. Operations

- One-person operation at first: build, sell, onboard and support.
- Support by WhatsApp with a stated response time.
- Onboarding checklist: import patients, set doctor schedules, train the receptionist, send a test reminder.
- Backups and a written incident process from day one.

## 11. Legal and data position

- Pakistan has no enacted data protection law as of 13 October 2026. A [draft bill](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/pakistan-data-privacy-laws/) would treat health data as sensitive and require explicit consent.
- Build consent, export, deletion and an audit log from the start so the product is ready if the law passes.
- No AI diagnosis or treatment advice, which keeps the product away from medical-device questions.
- Have a lawyer review the customer terms before the first paying customer. This has not been done.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Low prices from local tools | Sell onboarding and results; target the Rs 4,000 to Rs 10,000 band |
| Crowded market | Direct sales, free migration, WhatsApp-first workflow, referrals |
| Manual payment collection | Annual prepay, WhatsApp payment reminders |
| Custom requests, especially from hospitals | Clinics first; charge for custom work; modules switchable |
| WhatsApp cost or policy changes | Confirm Pakistan rates; click-to-send fallback |
| Patient data leak | Tenant isolation tests, encryption, audit log, tested backups |
| Draft data law passes | Consent and deletion built in from the start |
| Founder time spread thin | One vertical, one city, one 30-day test |

## 13. Open questions

- Which city launches first?
- What does WhatsApp cost per message in Pakistan through a provider?
- Will Marham or other platforms partner with clinic software vendors?
- Which payment methods do clinic owners prefer for subscriptions?
- What are the real monthly costs of hosting, backups and messaging?

## 14. Sources

- [Towards connected care: why Pakistan needs integrated electronic health records](https://pubmed.ncbi.nlm.nih.gov/42152212/)
- [e-Mareez clinic management](https://e-mareez.com/products/clinicmanagement)
- [Top dental software in Pakistan, ranked](https://dentalproapp.com/blog/top-dental-software-in-pakistan-ranked/)
- [Hospital management software in Pakistan](https://www.softwaresuggest.com/hospital-management-software/pakistan)
- [Best medical lab software in Pakistan](https://pmsapp.cloud/best-medical-lab-software-pakistan)
- [Best khata apps in Pakistan](https://udhaar.pk/best-khata-app/)
- [Pakistan data privacy laws](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/pakistan-data-privacy-laws/)
- [WhatsApp Business API pricing 2026](https://www.engagelab.com/blog/whatsapp-business-api-pricing)
