<!-- stardust provenance: skill=stardust:dynamics · phase=detect · 2026-10-12T17:05:41Z · 5 pages -->
# Dynamic features — detected (2026-10-12T17:05:41Z)

Evidence only — classify and triage with `dynamics-plan.mjs` (Phase 3). Source: `_dynamics.json`.

| id | class | feature | pages | reach | evidence | hint |
|---|---|---|---|---|---|---|
| F1 | F forms | form "calc" → (JS-submitted) (3 fields) | 1/5 |  | number:amount,number:years,number:rate | client-compute? |
| S1 | S search | site search form → /search | 5/5 |  | search:q | search |
| F2 | F forms | form-less control group in main (4 controls, submit "Send") | 1/5 |  | topic,amount,term,consent | forms |
| A1 | A APIs | first-party API GET /api/store-locator | 1/5 |  | GET /api/store-locator?lat,lng → 200 | api |
| F3 | F forms | form "contact" → /thanks (5 fields) | 1/5 |  | text:name,email:email,tel:phone,select:topic,textarea:message | forms |
| L1 | L listings | listing candidate .news (8 cards) | 1/5 |  |  | listings |
| M1 | M modals | modal trigger .js-modal → /contact | 2/5 |  | a.js-modal[href="/contact"] ×3 | modal |
| X1 | X session-bound | sign-in / account links | 5/5 |  | /online-banking/login<br>/online-banking/register | decided-out |
| X2 | X session-bound | session-bound dealer-locator shortlist | 1/5 |  | localStorage shortlist, cookie-bound | decided-out |
