# 06 · Public enquiry / booking request form

## Who and what for

A teacher, church secretary, club organiser or parent, almost always on a phone,
booking once a year. They know roughly when and roughly how many; they do not know
our deposit rules, closed days or gazebo stock. The form's only job is to replace a
free-form email with enough structure that the operator can send a proforma first
time: a workable date plus a fallback, a head count, who to reply to, and anything
the customer wants answered in writing. Everything else is optional or asked later.

## What the research and the best forms say

- **Field count beats step count.** Baymard: the average checkout has 11.3 fields
  but "most sites need only 8"; "form field count affects usability more than step
  count. Steps matter less, up to about 8 steps"
  ([baymard.com](https://baymard.com/blog/checkout-flow-average-form-fields)).
  NN/g's ten guidelines (short, single column, logical order, no placeholders,
  mark required/optional, specific errors) gave 78% one-try error-free submissions
  versus 42% ([nngroup.com](https://www.nngroup.com/articles/web-form-design/)).
- **One thing per page is GOV.UK's default** because "low-confidence users find
  them easier" and "they work well on mobile"; grouping is allowed "when evidence
  supports it" ([question pages](https://design-system.service.gov.uk/patterns/question-pages/),
  [GDS blog](https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/)).
  NN/g: wizards suit "novice users or infrequent processes"
  ([wizards](https://www.nngroup.com/articles/wizards/)). Fillout (a vendor) says
  one-question-at-a-time starts to hurt past 12–14 questions and recommends "a few
  pages with four to five questions per page"
  ([fillout.com](https://fillout.com/blog/one-question-at-a-time-form)).
- **Dates.** NN/g: calendars suit dates "within less than a year"; always allow
  typing; grey out illogical dates ([nngroup.com](https://www.nngroup.com/articles/date-input/)).
  GOV.UK: a calendar when users "need to see the day of the week", and "never make a
  calendar control that depends on JavaScript as the only input option"
  ([patterns/dates](https://design-system.service.gov.uk/patterns/dates/)).
  Baymard: travel users "already have a specific date … in mind" and abandon when
  the calendar "does not adequately or accurately communicate availability"
  ([baymard.com](https://baymard.com/ecommerce-design-examples/date-picker)).
- **Numbers and keyboards.** GOV.UK: "Do not use `<input type="number">`"; use
  `inputmode="numeric"`; no placeholders for hints
  ([text input](https://design-system.service.gov.uk/components/text-input/));
  phones get `type="tel"`, `autocomplete="tel"`, no masking
  ([telephone numbers](https://design-system.service.gov.uk/patterns/telephone-numbers/)).
  Baymard: 54% of mobile sites fail to invoke the right keyboard; the iOS phone
  keypad cannot type brackets or dashes
  ([baymard.com](https://baymard.com/research-articles/mobile-touch-keyboards)).
- **Explain the phone field.** 14% of shoppers will not give a number; 39% of sites
  require one without saying why; a one-line reason "alleviates the vast majority of
  users' privacy concerns" ([baymard.com](https://baymard.com/research-articles/explain-phone-number-field)).
- **Validation and errors.** Baymard: validate on blur, never before typing, clear
  on keystroke ([baymard.com](https://baymard.com/blog/inline-form-validation)).
  GOV.UK: "always show an error summary … even if there's only one", headed "There
  is a problem", focused, each item linking to its field, same words as inline
  ([error summary](https://design-system.service.gov.uk/components/error-summary/));
  messages avoid "please", "sorry", "invalid"
  ([error message](https://design-system.service.gov.uk/components/error-message/)).
  W3C WAI: `aria-describedby` on the field, focus the first error
  ([w3.org](https://www.w3.org/WAI/tutorials/forms/notifications/)).
- **Layout.** Baymard: multi-column forms are "generally problematic and never
  recommended" ([baymard.com](https://baymard.com/blog/avoid-multi-column-forms)).
  NN/g: mark every required field; placeholders strain memory and hide autofill
  ([required fields](https://www.nngroup.com/articles/required-fields/),
  [placeholders](https://www.nngroup.com/articles/form-design-placeholders/)).
  WCAG 2.2: targets 24×24 CSS px minimum
  ([w3.org](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
- **Check and confirm.** GOV.UK's check-answers page "gives users a second chance
  to notice and correct errors" ([check answers](https://design-system.service.gov.uk/patterns/check-answers/));
  a confirmation page carries the reference, "what happens next, including timing",
  contact details and a way to keep a record; users bookmark it as a receipt
  ([confirmation pages](https://design-system.service.gov.uk/patterns/confirmation-pages/)).
- **Turnstile.** Managed mode only challenges risky visitors; "tokens are
  single-use and expire after 300 seconds"
  ([developers.cloudflare.com](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)).
- **Real attraction forms.** Maryland Zoo asks 23 single-column fields: two date
  choices, ranked half-hour entry times, four age bands, arrival mode, add-ons —
  thorough for the operator, exhausting on a phone
  ([marylandzoo.org](https://www.marylandzoo.org/groups-and-parties/group-reservations/make-a-group-reservation)).
  Colchester Zoo lists "you will need the following information" before the form,
  says "payment is not required when booking" and promises a confirming email
  within five working days ([colchesterzoologicalsociety.com](https://www.colchesterzoologicalsociety.com/education/schools/school-tickets-booking-form/)).
  Hilton and Marriott ask dates, rooms and attendee count before who you are
  ([hilton.com](https://www.hilton.com/en-gb/events/groups/),
  [marriott.com](https://www.marriott.com/meeting-event-hotels/how-to-book/rfp.mi)).

## Principles that transfer

1. Visit first (date, numbers), group second, person last: what the customer cares
   about leads; the mobile number comes once they are invested, with a reason.
2. Four to five questions per screen, single column, visible labels, hints under
   the label, no placeholder examples.
3. The calendar starts where booking is possible and says why a day is greyed.
   Typing must work too.
4. One head count. Pricing is per person and the gate counts arrivals anyway.
5. Say what happens next, with a time, before the button and on the confirmation
   page. Give a reference they can keep.
6. Policy is reassurance, not a hurdle: positive sentences, no tick box.
7. Spam protection sits where the token is fresh: on the last screen.

## Critique of our current form

Screenshots in `data/screenshots/research/`:

- `form-mobile-stuck-skeleton.png` — **Blocking bug.** On a cold load the anonymous
  session check (`/api/v1/auth/session` → 401) fires `removeQueries` in
  `frontend/src/lib/auth.tsx:75`, which discards the in-flight `form-config` query;
  the page stays on the skeleton forever. Reproduced in 6 of 9 headless loads;
  delaying the 401 by two seconds makes it render every time. It is a race, not a
  headless artefact. Fix before any redesign.
- `form-mobile-top.png` / `form-mobile-full.png` — the first field is below the fold
  on a 390×844 phone; three explanatory cards take the screen. The page is 3.8
  screens tall with seven numbered sections that clash with the 1-2-3 cards above.
  Every example is a placeholder that vanishes on typing. "Vehicles" and "Gazebos"
  arrive pre-filled "0" while "Adults"/"Children" show a placeholder "0". All four
  counts are `type="number"` (spinner, scroll-wheel changes). The notes textarea
  hides its label. The Turnstile fallback text contradicts itself ("refresh the
  page" … "you can still send"); the widget could not load in the sandbox, so it is
  absent from the screenshots.
- `form-mobile-errors-top.png` / `form-mobile-errors-full.png` — on empty submit
  nine fields go red, the page scrolls to the first one and focuses it (good), but
  there is no error summary, so a user who tapped Send at the bottom is thrown to
  the top with no count or list. Adults *and* children are both required, so a
  pensioners' club gets an error on "Children". "Please accept the booking policy"
  uses the word GOV.UK tells you to drop.
- `form-mobile-datepicker.png` / `form-desktop-datepicker.png` — the picker opens on
  the current month, in which every day but the 31st is greyed: a wall of disabled
  dates before one that can be chosen. The popover covers the fields beneath it.
  The footer legend is good; nothing offers a "next open day" when someone wants a
  Monday.
- `form-desktop.png` / `form-desktop-full.png` — two- and three-column rows (Kind
  of group | Area; Email | Mobile; Arrival | Vehicles | Gazebos) in a 720 px column
  that does not need them.
- `form-mobile-sent-nostate.png` — after a refresh the reference is gone (router
  state) and the page falls back to a generic "Your request was sent". Nothing is
  emailed, so that screen is the customer's only record, and it gives no reply time.

## Recommendation for ours

**Structure: three question screens plus a check screen, on every width.** URLs
`/request/visit`, `/request/group`, `/request/contact`, `/request/check`,
`/request/sent/<id>`; caption "Step 1 of 3"; Back link; answers in `sessionStorage`
so a refresh loses nothing; full-width "Continue". Replace the three cards with one
line under the title: "We reply by email within one working day with a proforma;
nothing is paid now."

**Step 1 — "When would you like to come?"**

1. `Preferred date` (required). Hint: "We are open Wednesday to Sunday, 31 October
   2026 to 30 April 2027." Text input `dd/mm/yyyy` plus a calendar button: bottom
   sheet on phones, popover on desktop, opening on the first bookable month,
   Mondays/Tuesdays muted with a "Closed" legend, peak dot kept; read back
   "Saturday 7 November 2026 · peak rates apply" under the field. A closed day's
   error names the reason and the next open day: "We are closed on Mondays. The
   next open day is Wednesday 4 November."
2. `Alternative date` (optional). Hint: "If your first choice is full we will offer
   this one instead."
3. `How many visitors?` (required). `type="text" inputmode="numeric"`, width 5
   characters. Hint: "Adults and children together. A rough number is fine; we
   count on the day." Error: "Group bookings are for 10 or more people. For smaller
   groups, buy day tickets on Quicket." Above 900: "For more than 900 people please
   phone us on 081 461 4246."
4. `Arrival time` (optional). A select of half-hour slots 09:00–14:00 plus "Not
   sure yet" — no free text to normalise.

**Step 2 — "Tell us about your group"**

5. `Group name` (required). Hint: "Goes on your proforma and vehicle ticket, for
   example Sunshine Primary Grade 3."
6. `Kind of group` (required). Radios, the eight existing options.
7. `Area or town` (optional, `autocomplete="address-level2"`).
8. `Vehicles` (optional, numeric). Hint: "Buses, taxis and cars; the count goes on
   your vehicle ticket."
9. `Gazebos to hire` (optional, numeric, max 7). Hint: "Shaded spots. We have
   seven, first come first served."
10. `Questions for us` (optional). One visible box labelled "Question 1", "Add
    another question" up to five. Hint: "We answer these in our reply, in writing."
11. `Anything else we should know?` (optional textarea, label visible).

**Step 3 — "How do we reach you?"**

12. `Your name` (required, `autocomplete="name"`).
13. `Email` (required, `type="email"`, `autocomplete="email"`,
    `autocapitalize="none"`). Hint: "We send the proforma and your reference here."
14. `Mobile` (required, `type="tel"`, `autocomplete="tel"`). Hint: "We WhatsApp
    your vehicle ticket to this number." Accept `+27`, spaces and dashes.

**Check screen — "Check your answers".** Summary list with a "Change" link per
row. Then the policy as a declaration, not a checkbox:

> By sending this request you agree to our booking terms: your date is held once
> the deposit on the proforma is paid; the balance is paid on the day for the people
> who actually arrive, so a few more or fewer is fine; card payments are accepted at
> the gate.

Keep sending `policy_accepted: true`. Render Turnstile here only, managed mode,
`size: flexible`, directly above the button, so the 300-second token is minted
seconds before use (today it renders at page load, so anyone slower than five
minutes submits an expired token). Keep the honeypot. Button "Send request"; below
it "Nothing is paid now."

**Errors.** Validate each screen on Continue; "There is a problem" summary
(`role="alert"`, focused, items linking to fields) above the heading plus the same
words inline; `aria-invalid` and `aria-describedby`; clear on keystroke; no
"please".

**Confirmation `/request/sent/<id>`.** Green panel "Request sent", reference
`FY1728` large with a copy button; "We have emailed a copy to sam@school.co.za" —
an automatic acknowledgement with the reference and answers, a deliberate
exception to "nothing is sent automatically" for the operator to approve; a dated
promise ("We reply within one working day; we are closed Mondays and Tuesdays, so
a Sunday request may be answered on Wednesday"); the three next steps as now;
phone, email and a `wa.me` link. The URL must survive a refresh.

**Mobile and accessibility.** Single column everywhere; inputs 16 px and 44 px
tall; calendar cells at least 40 px; "(optional)" in the label instead of asterisks
on the majority; the date text input is the non-JavaScript path; focus moves to
the step heading on each Continue; colour never the only error cue.

## Sources

- Baymard: [checkout form fields](https://baymard.com/blog/checkout-flow-average-form-fields) ·
  [inline validation](https://baymard.com/blog/inline-form-validation) ·
  [multi-column forms](https://baymard.com/blog/avoid-multi-column-forms) ·
  [touch keyboards](https://baymard.com/research-articles/mobile-touch-keyboards) ·
  [explain the phone field](https://baymard.com/research-articles/explain-phone-number-field) ·
  [date pickers](https://baymard.com/ecommerce-design-examples/date-picker)
- GOV.UK Design System: [question pages](https://design-system.service.gov.uk/patterns/question-pages/) ·
  [dates](https://design-system.service.gov.uk/patterns/dates/) ·
  [date input](https://design-system.service.gov.uk/components/date-input/) ·
  [text input](https://design-system.service.gov.uk/components/text-input/) ·
  [telephone numbers](https://design-system.service.gov.uk/patterns/telephone-numbers/) ·
  [error summary](https://design-system.service.gov.uk/components/error-summary/) ·
  [error message](https://design-system.service.gov.uk/components/error-message/) ·
  [check answers](https://design-system.service.gov.uk/patterns/check-answers/) ·
  [confirmation pages](https://design-system.service.gov.uk/patterns/confirmation-pages/) ·
  [one thing per page (GDS blog)](https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/)
- NN/g: [web form design](https://www.nngroup.com/articles/web-form-design/) ·
  [date input](https://www.nngroup.com/articles/date-input/) ·
  [wizards](https://www.nngroup.com/articles/wizards/) ·
  [required fields](https://www.nngroup.com/articles/required-fields/) ·
  [placeholders](https://www.nngroup.com/articles/form-design-placeholders/)
- W3C: [form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/) ·
  [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Cloudflare Turnstile: [widget types](https://developers.cloudflare.com/turnstile/concepts/widget/) ·
  [widget configurations](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- Conversational forms: [Fillout](https://fillout.com/blog/one-question-at-a-time-form) ·
  [Typeform completion rates](https://help.typeform.com/hc/en-us/articles/360029615911)
- Attraction and hospitality forms: [Maryland Zoo](https://www.marylandzoo.org/groups-and-parties/group-reservations/make-a-group-reservation) ·
  [Colchester Zoo schools](https://www.colchesterzoologicalsociety.com/education/schools/school-tickets-booking-form/) ·
  [Chester Zoo groups](https://www.chesterzoo.org/tickets-membership-experiences/group-visits) ·
  [Zoo Atlanta groups](https://zooatlanta.getanchor.io/visit/groups/index.html) ·
  [Hilton groups](https://www.hilton.com/en-gb/events/groups/) ·
  [Marriott RFP](https://www.marriott.com/meeting-event-hotels/how-to-book/rfp.mi) ·
  [Gold Reef City FAQ](https://www.goldreefcity.co.za/theme-park/frequently-asked-questions/)
  (Gold Reef City and uShaka publish no public group form; both route groups to
  phone or email, which is the gap this form fills.)
