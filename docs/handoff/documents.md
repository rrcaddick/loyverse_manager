# Documents agent — handoff

Finance documents (proforma, invoice, final invoice) as WeasyPrint PDFs, and
every outbound customer email (subject + HTML + text). Built against
`docs/booking-system.md` §4, §6, §7. Nothing here sends mail or changes a
booking's status: `issue_document` stores a file, a `documents` row and a
`booking_events` row, and that is all.

## Files owned

| Path | What |
| --- | --- |
| `src/models/document.py` | `insert`, `get`, `list_for_booking`, `latest`, `latest_version_for_number`, `set_email_message` |
| `src/services/documents.py` | rendering, finance maths, `issue_document`, `document_bytes`, formatting helpers, sample data |
| `src/services/email_templates.py` | `RenderedEmail`, `render_email(kind, booking, settings, **ctx)` |
| `web/templates/documents/` | `base.html`, `document.css`, `_lines.html`, `proforma.html`, `invoice.html`, `final_invoice.html` |
| `web/templates/emails/` | `base.html`, `email.css`, `_macros.html`, one body per kind |
| `web/api/documents.py` | `bp = make_blueprint("documents", "")` — already listed in `API_MODULES` |
| `web/static/brand/fonts/` | `InterVariable.ttf` (Inter 4.1, OFL, 880 KB), licence, README |
| `tests/documents/` | pytest: maths, every PDF kind, every email kind, DB issue path, API |

## Endpoints (all `@require_role("admin")`, under `/api/v1`)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/documents/<id>/pdf` | `application/pdf`, `Content-Disposition: inline; filename="INV1703 Invoice.pdf"`; `?download=1` for attachment. 404 when the row or file is missing. |
| GET | `/bookings/<id>/documents` | `{"items": [doc, ...]}` newest first (no snapshot). Empty list for unknown bookings. |
| POST | `/bookings/<id>/documents/preview` `{kind}` | PDF bytes of the booking as it stands; nothing stored. 422 unknown kind, 404 unknown booking. |
| GET | `/documents/email-preview/<kind>?booking_id=&format=html\|text\|json&logo_url=` | Rendered email. Without `booking_id` a fictitious sample booking is used so copy can be reviewed. With one, the booking's payments and its latest matching document feed the template. `logo_url` defaults to `<request root>/static/brand/logo-black-600.png`. |

Document dict (as returned by the API and `issue_document`):
`{id, booking_id, kind, number, version, file_path, total, paid, due, issued_at, issued_by, email_message_id, label, filename}`
— `label` is "Proforma" / "Invoice" / "Final invoice", `filename` is the
attachment name (`FY1703 Proforma.pdf`). `file_path` is **relative to
`DATA_DIR`** (`documents/<booking_id>/<number>-v<version>.pdf`); use
`documents_service.document_path(row)` or `document_bytes(id)` rather than
opening it yourself.

## Service signatures

```python
# src/services/documents.py
render_document_pdf(booking: dict, kind: str, settings, payments: list[dict] | None = None,
                    *, number: str | None = None, version: int = 1, issued_on: date | None = None) -> bytes
render_document_html(...same...) -> str
issue_document(booking_id: int, kind: str, actor: int | None, settings=None) -> dict     # serialized document
document_bytes(document_id: int) -> tuple[str, bytes]                                     # (filename, pdf)
preview_document(booking_id: int, kind: str, settings=None) -> bytes
list_documents(booking_id) -> list[dict];  get_document(document_id, with_snapshot=False) -> dict | None
compute_finance(booking, kind, settings, payments=None) -> dict   # Decimals, see below
document_number(booking, kind, settings) -> str                    # FY1703 / INV1703 (reference when doc_number is NULL)
sample_booking() -> dict; sample_payments() -> list[dict]
money(x) -> "R6 365.00"; date_long(d) -> "Saturday 7 November 2026"; date_medium(d) -> "7 November 2026"; phone_display("27821234567") -> "082 123 4567"
class DocumentError(Exception)     # unknown booking/document/kind; the API maps it to 404

# src/services/email_templates.py
@dataclass RenderedEmail(subject: str, html: str, text: str)
render_email(kind: str, booking: dict | None, settings, **ctx) -> RenderedEmail
KINDS = (acknowledgement, proforma, invoice, final_invoice, ticket, payment_confirmation,
         still_interested, deposit_reminder, final_details, expiry, answers, bounce_back, reply)
class EmailTemplateError(Exception)
```

`booking` is the raw `bookings` row (`SELECT *`), Decimals/dates or their
JSON-serialised forms both work. `settings` is `get_settings()`.

### Money rules implemented

Prices are VAT inclusive at `pricing.vat_rate`. `qty` = `people_booked`
(proforma, invoice) or `arrived_count` (final invoice; falls back to
`people_booked` with a note when NULL). `total = qty × price_per_person`,
`vat = total × r/(100+r)` (ROUND_HALF_UP), `subtotal = total − vat`,
`paid = Σ payments.amount`, `due = total − paid`, `deposit_due` from the row
(0 when `deposit_waived`, capped at total), `deposit_outstanding =
max(deposit_due − paid, 0)`, `balance_on_day = total − max(paid, deposit_due)`.
The line's VAT column is the VAT total (not unit VAT × qty), so the table and
the totals block agree to the cent.

`documents.total/paid/due` always store `total`, `paid`, `total − paid`,
whatever the kind. The proforma *displays* `deposit_outstanding` as the
figure to act on.

### Versioning

Version is counted **per number per booking**, not per kind: the invoice and
the final invoice share `INV1703`, so a final invoice issued after an invoice
is `INV1703-v2.pdf` and the event reads "Final invoice INV1703 issued (v2)".
That keeps file names unique and `latest(booking_id, kind)` still works per
kind. The booking row is locked (`FOR UPDATE`) while the version is minted.

### Payment reference

Every document and email tells the customer to pay with the **booking
reference** (`FY1703`), including the invoice, rather than the hand-made
invoice's `INV1726`. One reference per booking makes the bank matcher's job
trivial. Say if you want the invoice to use `INV…` instead — it is one line
in `build_document_context` (`doc.payment_reference`).

### Document headings

"Proforma invoice" (with a "not a tax invoice" note), "Tax invoice", "Final
tax invoice". SARS wants the words "tax invoice" plus the VAT number on a
VAT invoice; both are on the page and in the page footer.

## Email context contract (per kind)

Common `**ctx` for every kind: `logo_url` (absolute https URL; falls back to a
text wordmark), `payments` (list of payments rows → paid/due figures),
`subject` (override), `preheader` (override).

| kind | needs | optional |
| --- | --- | --- |
| acknowledgement | booking | `form_url` |
| proforma | booking | `document` {number,total,paid,due}, `hold_expires_on` (defaults to the row's) |
| invoice | booking, `payments` | `document` |
| final_invoice | booking, `payments` | `document` |
| ticket | booking | `payments`, `rules_url` (default `https://<settings.email.website>`) |
| payment_confirmation | booking, `payment` {amount,paid_on,reference}, `payments` | `invoice_attached: bool` |
| still_interested | booking | `document` (proforma), `hold_expires_on` |
| deposit_reminder | booking | `days_left` (default: visit_date − today), `hold_expires_on` |
| final_details | booking, `payments` | `days_left`, `ticket_attached: bool` (default True), `rules_url` |
| expiry | booking | — |
| answers | booking, `questions` [{question, answer}] | — |
| bounce_back | — (booking None) | `form_url` |
| reply | `body_html` | booking (None allowed), `subject` |

Subjects follow `"<Topic> <ref> – <group> – <Saturday 7 November 2026>"`,
e.g. `Proforma FY1703 – Hillside Community Church – Saturday 7 November 2026`,
`Invoice INV1703 – …`, `Payment received FY1703 – …`, `Still planning to
visit? FY1703 – …`. `bounce_back` is `Group bookings at The Farmyard Park`.
`reply` defaults to `FY1703 – group – date` unless `subject` is given.

Suggested wiring for the bookings agent:

```python
doc = documents_service.issue_document(booking_id, "proforma", actor)
filename, pdf = documents_service.document_bytes(doc["id"])
rendered = render_email("proforma", booking_row, settings, document=doc,
                        payments=payments, logo_url=f"{PUBLIC_BASE_URL}/static/brand/logo-black-600.png")
mail_send.send_email(to=[...], rendered=rendered, attachments=[(filename, pdf, "application/pdf")],
                     booking_id=booking_id, kind="proforma", actor=actor)
document_model.set_email_message(doc["id"], email_message.id)   # optional back-link
```

## Dockerfile

The WeasyPrint wheel needs these Debian packages at runtime (no browser, no
system fonts: Inter is bundled and referenced by `file://` URL):

```
libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 libffi8 libcairo2 libgdk-pixbuf-2.0-0 shared-mime-info fontconfig
```

`fontconfig` is required (Pango needs a font config even with `@font-face`);
`fonts-dejavu-core` is a cheap safety net for any glyph Inter lacks. The
`DATA_DIR` volume must be writable by the app user.

## Preview files (gitignored, regenerated by `pytest tests/documents`)

```
data/documents/preview/proforma.pdf         # and invoice.pdf, final_invoice.pdf
data/documents/preview/proforma.png         # 100 dpi page-1 renders of each (from the design pass)
data/documents/preview/final_invoice_3pay.png
data/documents/preview/email-<kind>.html    # inlined HTML for all 13 kinds
data/documents/preview/email-<kind>.txt     # "Subject: …" + text alternative
```

Render time: 0.7–0.9 s per PDF warm, ~1.4 s cold (font load); emails ~10 ms.

## Tests

`.venv/bin/python -m pytest tests/documents -q` — 37 tests. `test_issue_db.py`
and `test_api.py` need MySQL (they skip otherwise) and create a booking
whose `group_name` starts with `TEST ` which is deleted in teardown
(cascade removes documents/events/payments; the file directory is removed
too). `test_api.py` signs in as a throwaway admin row
(`test-documents-agent@example.test`) that it inserts and deletes itself.

Heads-up while agents run in parallel: `test_issue_db.py` fails with
"Booking N not found" if another agent's suite sweeps `TEST %` bookings at
the same moment (seen once, passed on rerun). It is a shared-DB race, not a
code path problem.

## Decisions and known gaps

- **Dependency direction**: `email_templates` imports formatting helpers and
  the Jinja environment from `documents`; WeasyPrint is imported lazily so
  rendering an email never loads it.
- **Jinja**: a standalone `Environment` over `web/templates` (no Flask app
  context needed), so the scheduler and scripts can render too.
- **Font**: WeasyPrint 70 rejects the `font-weight: 100 900` range descriptor,
  so the `@font-face` has none; Pango picks weights 400/500/600/700 from the
  variable font's axis anyway (verified: four distinct subsets end up in the
  PDF). Do not swap in static TTFs without re-checking the 1.5 MB budget.
- **Logo**: the PDF uses `web/static/brand/logo.svg` (vector). Emails need a
  public https URL passed as `logo_url`; nothing in `config/settings.py`
  names the public base URL today, so the API preview derives it from the
  request and the mail agent should do the same (or add `PUBLIC_BASE_URL`).
- **Page budget**: all three kinds fit one A4 page with up to three payments.
  More payments flow to a second page with the running footer.
- **`reply` body**: `body_html` is inserted unescaped (admin-authored).
- **Overpayment** on the final invoice shows "Credit due to you"; no refund
  flow exists.
- **Snapshot** JSON stores the booking row, lines, totals, payments and the
  documents settings used; floats, not Decimals.
- The invoice's "Your vehicle entry ticket will follow" sentence assumes the
  ticket is sent after the deposit; adjust in `emails/invoice.html` if the
  flow changes.
