# 05 — Payment reconciliation, finance documents, transactional email

Screenshots: `data/screenshots/research/pay-*.png` (list, unmatched filter,
suggested and matched drawers, both emails at 1440 and 375 px). PDFs:
`data/documents/preview/{proforma,invoice,final_invoice}.pdf`.

## Who and what for

One operator, several times a day, after the five-minute FNB poll. Her
question is "which credits need me?": confirm a suggested match, match the odd
credit by hand, park the park's own transfers, then send the payment
confirmation. Of 289 entries polled so far, 234 are debits and about 40 of the
55 credits are non-booking money (own transfers, interest, card settlements):
the actionable set on any day is a handful of rows. The documents are read by
a church treasurer, a school bursar or a company bookkeeper who needs
SARS-valid paperwork that says what to pay. The emails are read on a phone;
the reader's only action is an EFT with the right reference.

## What the best products do

**Xero.** A bank account opens on the *Reconcile* tab with the count in the
heading ("Reconcile 29 items") and the statement and Xero balances above.
Each row is two halves: the statement line on the left, the proposed invoice
on the right tinted green with an **OK** button on the same row, plus Match /
Create / Transfer / Discuss tabs. Xero auto-reconciles only "when it's highly
confident"; otherwise "it suggests a match but gives you the final say".
Find & Match ticks several records against a running total; Unreconcile or
Remove & Redo puts a line back on the Reconcile tab; bank rules absorb
recurring noise.

**QuickBooks Online.** Tabs *For review*, *Posted*, *Excluded*. Suggestions are
"the same amount within a specific date range (90 days before to 20 days
after)"; the row says "1 record found" in a green box, you press **Post** or
**Find other match**; Undo "moves the transaction back to the For review tab".
Nothing is scored.

**Stripe.** The payments list is amount, status, date, with filters for amount,
date, status and method; the detail page is a timeline plus fee, description,
method and a receipt history. Receipts must carry the legal name and support
contact; invoice PDFs get a memo, a legal footer, up to four header fields (PO
numbers), tax IDs, sequential numbers and tax-inclusive line prices by default.

**Mews** reconciles through a Payment report (Mode × Status × date range)
compared with bank transfers at month end — a report, the wrong shape for a
daily task. **Cloudbeds** attaches a payout ID to each card payment once
settled and lists payouts with status (Paid / Pending / Failed), the count of
payments inside and the net amount: group by what hit the bank.

## Principles that transfer

1. The work queue *is* the screen: default to "needs me", count it in the
   heading, everything else one tab away.
2. Side by side: bank line left, what it would settle right, arithmetic shown.
3. Confidence is words and a green tint, never a score. Act automatically only
   when certain; otherwise one click to accept.
4. Accept and undo are symmetrical one-click actions; no modal for anything
   reversible.
5. Recurring noise gets a rule, not a daily click.
6. A running balance belongs on a statement tab, not a work list.
7. Documents: one page, serial numbers, legal text in the footer, prices as
   quoted (inclusive), tax IDs for both parties.
8. Emails: the key fact in the subject, the amount at the top, one card, one
   action, a plain-text twin, the company as sender.

## SARS tax invoice checklist versus our documents

SARS requires a **full tax invoice** where the consideration (incl. VAT)
exceeds R5 000 and allows an **abridged** one from R50 to R5 000 (seven and
five criteria on SARS's checklist). A typical invoice here (67 × R95 =
R6 365) is full-invoice territory; design to the full standard always.

| SARS criterion (full) | Our `invoice.pdf` / `final_invoice.pdf` | Verdict |
| --- | --- | --- |
| Words "Tax Invoice", "VAT Invoice" or "Invoice" | "Tax invoice" / "Final tax invoice" | Pass |
| Supplier name, address, VAT number | Pty Ltd, Protea Road, Klapmuts, VAT 4780 308 575, repeated in footer | Pass |
| Recipient name **and address**; VAT number if a vendor | "Hillside Community Church / Kuils River" — an area, no address; no customer VAT field | **Fail**; a corporate client cannot claim input VAT |
| Serial number and date of issue | INV1703, 8 October 2026 | Pass, but the final invoice re-uses **INV1703** (v2) for a different consideration (R5 795 vs R6 365). A changed consideration wants a credit note (VAT Act s21) or a new serial |
| Accurate description | "Visitors @ R95.00" | Weak; say what and when |
| Quantity or volume | 67 / 61 | Pass |
| Value, tax charged, consideration | R5 534.78 / R830.22 / R6 365.00 | Pass |

Proforma: SARS has no proforma rules; it must not pass for a tax invoice. Ours
is headed "Proforma invoice", says "not a tax invoice" and sits outside the
INV sequence. Pass; add "VAT may not be claimed on this document".

## Critique of our current build

**Payments screen** (`frontend/src/pages/payments/PaymentsPage.tsx`,
`features/payments/transaction-drawer.tsx`, `suggestion-picker.tsx`).

- Six tiles answer six questions. "Unmatched 276" counts debits and own
  transfers, so the headline is never actionable; "Unmatched credits, 30 days
  R492 649.12" is mostly `TRANSFER CALL-PLAT` rows and reads as an alarm;
  "Ignored 0" is dead space.
- The default list is every entry, newest first: seven of the first ten rows
  are card purchases. "Credits only" and the status must be set on every
  visit; nothing is remembered.
- A suggested row's only cue is `FY1710?` in grey in the last column; the
  running balance column spends 130 px on numbers nobody uses here.
- Drawer: six rows of bank metadata precede the decision. All five candidates
  show **Score 40** (the score discriminates nothing) and the first is
  pre-selected — FY1705, already Confirmed with R5 000 paid — while the one
  that "equals the deposit" with R0 paid (FY1698) is fourth. The primary
  button reads "Confirm FY1705" and sits below the fold at 900 px.
- Confirm opens a second dialog; undo is "Remove match" plus a dialog; unmatch
  does not revert the booking status (`docs/handoff/payments.md` gap 1).
  "Poll now" demands confirmation for a read-only action.
- No rules, so `TRANSFER CALL-PLAT`, interest and Netcash are ignored by hand
  every week. No next step after a match (send the payment confirmation).

**Documents** (`web/templates/documents/base.html`, `_lines.html`,
`invoice.html`, `final_invoice.html`, `document.css`).

- The layout is right: one accent on the figure to act on, the grey visit
  strip, the boxed bank details with the reference in green, reg and VAT in
  the footer. Keep it.
- Compliance gaps as tabled: recipient address and VAT field, serial re-use,
  thin description.
- "Unit price ex VAT R82.61" on a line sold as "R95 each" confuses a treasurer;
  Stripe defaults to inclusive line prices with VAT in the totals.
- "Booked by" prints the contact's personal mobile and email on an invoice;
  "Number FY1703 / Booking ref FY1703" is one value twice on the proforma; the
  final invoice says "payable at the gate" and then shows bank details.

**Emails** (`web/templates/emails/base.html`, `_macros.html`, `email.css`,
`proforma.html`, `payment_confirmation.html`).

- Fundamentals are right: 600 px tables, one summary card, logo, preheaders,
  plain-text twin, footer with VAT and the reference line, media query.
- Subjects run 61–86 characters, all `Topic FY1703 – Group – Saturday 7
  November 2026`; Postmark's guidance is ~50 with the key fact first.
  "Payment received" never states the amount.
- At 375 px the card's key column wraps ("Deposit / due") while the value stays
  bold.
- The proforma buries the three things to do (pay, use the reference, email
  proof) in one paragraph; the payment confirmation's green hero is "Balance
  due R2 565.00" under a "Payment received" headline — the wrong figure.

## Recommendation for ours

**Summary.** One line under the title replaces the tiles: *"4 to confirm · 12
unmatched credits this month · last poll 20:10, OK"*. The first two are links;
the poll word turns red with the error when it fails. The rand total moves to
the Unmatched list's footer, where it sums what is on screen.

**Tabs.** *Needs attention* (default; suggested first, then unmatched credits,
oldest first; debits never appear), *Matched*, *All entries* (today's list with
the balance column). Remember the tab.

**Row anatomy** on Needs attention, Xero-style halves. Left: date, amount
large and tabular, description, reference in mono. Right: the proposal as a
card — `FY1698 · Harbour of Hope Ministries · Sat 7 Nov · Proforma sent` — one
line of arithmetic, "R3 800 = deposit · R0 paid · R11 400 total", and a green
**Match** button on the row. Confidence is the sentence, never a number:
"Equals the deposit" (green), "Part of the balance", "Exceeds the balance"
(grey); drop `score`. Order candidates by that sentence then nearest visit
date; pre-select nothing when two tie. Several candidates show "3 possible
bookings — choose" and expand in place. Unmatched rows get **Find booking…**
and **Ignore ▾** (*Own transfer*, *Card settlement*, *Interest*, *Other…*; the
first three create a description rule so the row never returns).

**Confirm/undo.** No modal. Match records the payment, the row slides to
Matched, a toast says "R3 800 recorded on FY1698 · **Undo**" for ten seconds,
then offers **Send payment confirmation** when the deposit is now covered.
Later, Matched → Remove match is one click, and `unmatch` must revert
`confirmed → proforma_sent` when the deposit is no longer covered. Poll now
runs without a dialog. The drawer keeps the raw entry, reordered: amount and
description, match block, bank metadata collapsed.

**Documents.** Add `billing_address` and `customer_vat_number` to the booking
and print them under "Bill to". Give the final invoice its own number and,
when arrivals reduce the total, issue *Credit note CN1703* against INV1703 (or
make the final invoice the only tax invoice and call the deposit document
"Deposit invoice") — confirm with the accountant. Describe the supply: "Group
day admission, Saturday 7 November 2026". Show the line as `67 × R95.00 =
R6 365.00` with "Includes VAT 15% R830.22" in the totals. Take the contact's
phone and email off the invoice, drop the duplicate "Booking ref" row, and
drop the bank box from the final invoice when the balance is paid at the gate.

**Emails.** Subjects: `Proforma FY1703 – R3 800 deposit by 31 Oct`, `Payment
received: R3 800.00 – FY1703`, `Invoice INV1703 – balance R2 565 on 7 Nov`;
group and date go to the preheader. Make the amount the first row of the card
(Stripe receipt pattern), turn the proforma's instructions into a three-item
list, add one "Attached: FY1703 Proforma.pdf" line, and stack the card rows
below 480 px. Everything else stands.

## Sources

- SARS, *Checklist: VAT invoices* — https://www.sars.gov.za/wp-content/uploads/Docs/Government/Tax-Invoice-Checklist-Version-2-29032016.pdf
- SARS, *Tax Invoices* (R5 000, R50, 21 days) — https://www.sars.gov.za/businesses-and-employers/government/tax-invoices/
- SARS, Interpretation Note 83 (s20 threshold) — https://www.sars.gov.za/wp-content/uploads/Legal/Notes/Legal-IntR-IN-83-Application-of-sections-207-and-215.pdf
- Xero, reconcile product page — https://www.xero.com/us/accounting-software/reconcile-bank-transactions/
- Xero Central, Find & Match — https://central.xero.com/0/article/Reconcile-a-bank-statement-line-using-Find-Match ; Unreconcile — https://central.xero.com/0/article/Unreconcile-an-account-transaction
- Xero reconcile screen walkthrough — https://marcandrews.com/xero-bank-reconciliation-tutorial-uk-step-by-step-guide/
- Intuit, *Match your bank and credit card transactions* — https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US
- Stripe, payments overview — https://support.stripe.com/embedded-connect/questions/payments-overview ; receipts — https://docs.stripe.com/receipts ; customize invoices — https://docs.stripe.com/invoicing/customize
- Mews, *How to reconcile the month* — https://help.mews.com/s/article/How-to-reconcile-the-month-in-Mews-Operations
- Cloudbeds, payment reports and reconciliation — https://myfrontdesk.cloudbeds.com/hc/en-us/articles/38783504859419 ; payouts — https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360055770874
- Postmark, best practices — https://postmarkapp.com/guides/transactional-email-best-practices ; subject lines — https://postmarkapp.com/blog/transactional-email-subject-lines ; receipts — https://postmarkapp.com/blog/receipt-templates-best-practices
- Really Good Emails, Receipt / Payment — https://reallygoodemails.com/categories/receipt-payment
- Xero ZA, *How to make an invoice* — https://www.xero.com/za/guides/invoicing/how-to-make-an-invoice/
