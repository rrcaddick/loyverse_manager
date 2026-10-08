# 01 — Navigation, the work queue and the dashboard

Research note, October 2026. Screenshots are in
`data/screenshots/research/ia-*.png` (1440×900, logged in as a read-only admin).

## Who and what for

Three people, three rhythms. **Linda** (operator) lives in the app all day:
enquiry mail, proformas, deposits the bank matched, tickets, reminders, and on
visit days arrivals and gate payments. Her question every time she looks up is
*"what do I do next, and is anything on fire?"* **Marcelino** (manager) opens it
on visit days only: *who is coming, how many have arrived, what is still owed.*
**Ray** (owner) wants that day picture plus money and whether the machines (mail
sync, bank poll, the Loyverse morning sync) are running. The POS tooling will
share the site, so the shell needs a park area without the booking screens
getting louder.

## What the best products do

**Front.** The sidebar is a short personal stack — **Open / Later / Done** —
then collapsible **Pinned, Views, Shared**. No dashboard: you land in Open, one
conversation list with the reader beside it. Views are saved queries (one tag
across inboxes, one view per teammate); rarely used sections go under **More**
(help.front.com/en/articles/3889728).

**Help Scout.** No dashboard either; home is the folder list. **Unassigned,
Mine, Assigned, Closed, Spam** are always there; **Needs Attention** and
**Drafts** exist only while non-empty. Sidebar counts include *Active*
conversations only, not Pending: a badge means a person must act
(docs.helpscout.com/article/1429).

**Zendesk.** A **Views** rail of eight standard views ("Your unsolved tickets",
"Unassigned tickets", "Pending", "Recently solved"…); each view is one table with
per-view columns, a coloured status icon per row and a count beside the name
(support.zendesk.com, Accessing your views of tickets).

**Linear.** **Inbox** (*Priority* vs *Other* tabs, J/K, H to snooze), **My
Issues**, and per-team **Triage**: an intake list with a fixed verb set — Accept
`1`, Decline `2`, Duplicate `3`, Snooze `H` — shown list-beside-detail so you
never leave the queue; `G` `T` jumps there (linear.app/docs/triage).

**Shopify Home.** One row of four metrics (sessions, sales, orders, conversion;
date picker; per-user swap), then **order tasks** "organized by task, with the
number of each task that needs to be completed" — the only cards you cannot
dismiss — then advice cards. Sidebar: Home, Orders (open count), Products,
Customers…; Settings bottom-left; breadcrumbs since 2025
(help.shopify.com/manual/shopify-admin/shopify-home).

**Stripe.** Home = "Your overview" charts (Add → Apply) plus "important
notifications, like unresolved disputes" at the top. Sidebar group one: Home,
Balances, Transactions, Customers, Product catalog; **Shortcuts** holds pinned
and recent pages; `?` lists keys (docs.stripe.com/dashboard/basics).

**Mews Operations.** Home is nine today-only donuts, each opening its report:
**Tasks** (upcoming, missed), **Reservations** (arrivals/departures: remaining,
missed, done via portal), **Orders**, **Spaces** (clean/dirty), **Customers**,
**Occupancy** (next week), **Finance & Reports** shortcuts; Alt+N new
reservation (help.mews.com/s/article/your-dashboard).

**Cloudbeds.** The dashboard is the first screen after login: tiles
**Arrivals, Departures, In-house, Stayovers, Bookings**, each with two numbers —
the day's total and, in blue, "remaining to be checked in/out"
(myfrontdesk.cloudbeds.com, Dashboard – everything you need to know).

**FareHarbor.** Top bar **Bookings | Manifest | Reports**. The Manifest is a
"real-time snapshot of daily bookings" sortable by activity, guide or time with
check-in statuses; a booking overview shows contact, payment status, check-in
status and actions (help.fareharbor.com, Navigating the Dashboard).

**Peek Pro.** Staff routine: "click Dashboard on the left, then Manifest" —
today by default, a calendar icon for other dates; admins "review key stats on
the dashboard to prepare for the next day" (wheelfunrentals.com/peek-set-up-and-use).

**Toast / Lightspeed.** Toast's homepage: a **Quick actions** strip and a
*today or yesterday* filter with "compare to same day last week". Lightspeed
lands on a 30-day Dashboard behind thirteen sidebar groups — the cautionary
example for an all-day operator (support.toasttab.com;
k-series-support.lightspeedhq.com).

## Principles that transfer

1. **Help desks have no dashboard; venues have a Today.** Front, Help Scout,
   Zendesk and Linear land you in *one list*; Mews, Cloudbeds, FareHarbor and
   Peek land you on *today*. We are both, so we need both — as two screens,
   never one page of ten lists.
2. **One list per view, views in a rail, counts only where a person must act.**
   Help Scout counts Active not Pending; Shopify counts tasks, not orders;
   HMRC's pattern shows no badge at zero. A count promises to reach zero.
3. **Conditional views.** Needs Attention appears only when it has something;
   empty kinds leave the rail rather than render as cards.
4. **Fixed row anatomy, fixed verbs.** Linear's 1/2/3/H works because every
   row is the same shape and the primary verb is always in the same place.
5. **A dashboard is one screen read in seconds** (NN/g): position and length
   beat colour, colour reinforces rather than encodes, no donuts or gauges.
   Four or five numbers each with its "remaining" (Cloudbeds), and a short list.
6. **Empty states carry status, a learning cue and a pathway** (NN/g).
7. **Settings at the bottom, breadcrumbs everywhere, one search** (Shopify,
   Stripe); our shell already has those bones.

## Critique of our current build

- **`ia-home.png` is a portal, not a home.** Ten count tiles, "146 items across
  8 sections", then ten stacked section cards; the page is 6 563 px tall — more
  than seven screens. The first actionable row starts 400 px down. The tile
  strip is a second navigation that only anchors to headings on the same page,
  while the sidebar has no counts at all.
- **The counts are not work.** `ia-home-scroll4200.png`: "Reminders due 39" is
  one deposit reminder plus 38 "Still interested?" rows **225–260 days overdue**
  with no email on the booking, so Send is disabled. `ia-home-scroll900.png`:
  "Needs a reply 15" includes threads waiting 20–86 days. A first-time user
  sees a mountain she cannot reduce.
- **Six different verb pairs.** "Open thread / Open booking" (ghost), "Review",
  "Confirm match" (filled) + "More", "Match… / Ignore", "Send / Dismiss",
  "Email ticket / WhatsApp ticket", "Extend hold / Send expiry". Only one
  section has a filled primary. Nothing teaches "the right-hand button moves it
  on" because that button changes style and meaning per card.
- **The visit day is buried.** "Visits this week" and "Arrivals to record" sit
  eighth and ninth (`ia-home-scroll5600.png`), five screens down — the two
  things the manager and the gate care about.
- **Sidebar (every screenshot).** "Queue" is the home, yet the breadcrumb says
  *Home › Queue*. "Ops" is jargon; "Inbox" is Gmail's word for what is really
  *mail to link to bookings*. No counts, no place for the POS tooling.
- **`ia-inbox.png`** — the three-pane layout is right, but "Unmatched 166" is a
  permanent backlog tab and "Review 49" repeats the home tile under another
  label.
- **`ia-payments.png`** — six tiles, one of them "Unmatched 276" (mostly debits:
  Clicks, Mediclinic, Checkers). The operator's job is credits. "Last poll ·
  Success" is system health leaking into a work screen; the table shows debits
  by default.
- **`ia-ops.png`** — worker health (Mail sync, Bank poll, Scheduler **off**)
  sits beside "Bookings by status" and import diagnostics. The most important
  fact — nothing fires on a timer — is a small amber chip in row two.
- **`ia-day.png` is the best screen in the app** and already the Cloudbeds
  pattern: four tiles (Groups 3, People 300 · 200 confirmed, Arrived 0 of 200,
  Outstanding R20 210 · R7 790 paid) and per-group cards with Booked / Arrived /
  Paid / Balance and three actions. It is reachable only through the calendar.
- **`ia-booking-detail.png`** — eleven buttons in two action rows, most
  disabled. **`ia-calendar.png`** — thirty cells say "Closed"; the week column
  says "0 of 0 people" four times. Hatching alone would say it.

## Recommendation for ours

**Sidebar** (one flat list, counts only where they reach zero; the manager
sees the first three):

```
Today            ← home; the day view for today, G then T
Work        12   ← the queue: one list, views in a rail
Calendar
Bookings
Mail         9   ← was Inbox; count = inbound mail not yet linked, this week
Bank         4   ← was Payments; count = credits to confirm
—
Gate             ← POS tooling: arrivals, open tickets, morning sync (new)
—
Settings · Users · System (was Ops)   [bottom, with the user menu]
```

**Today, above the fold at 1440×900.** Row 1: "Thursday 8 October · Closed day
/ Weekend rate", *Add booking*. Row 2, four tiles with total + remaining, as
`ia-day.png` already has: **Groups today** (3 · 0 arrived), **People** (300 ·
200 confirmed), **Owed at the gate** (R20 210 · R7 790 paid), **Needs you** (12
· oldest 3 d → opens Work). Row 3, two columns: left two-thirds, today's groups
as compact cards (Booked / Arrived / Paid / Balance, *Record arrivals* the one
filled button) or, on a closed day, "Next visit day: Sat 31 Oct · 3 groups · 300
people" with a seven-day strip; right third, **Up next** — the five most urgent
Work rows, one line each with the verb — then a three-dot **System** line (Mail
20:11 ✓ · Bank 20:10 ✓ · Loyverse sync — schedule off ●) linking to System.
Nothing below the fold is required. Not here: bookings by status, 30-day charts,
debits, import diagnostics, stale-reminder counts.

**Work page.** Left rail of kinds in pipeline order, each with a count, hidden
at zero: *Reply* · *New requests* · *Confirm money* (suggested and unmatched
credits merged) · *Send tickets* · *Reminders* · *Holds lapsing* · *Record
arrivals*. Unlinked mail lives in Mail, not here. The default view **Up next**
merges the oldest ten across kinds. Reminders over 30 days old go to a *Stale*
view with bulk Dismiss so the live count is honest.

Row anatomy, identical in every view: status dot · `FY1737` **Group** · date ·
people | one grey line of context ("Therlo, waiting 86 d" or "Suggested FY1710 ·
equals deposit R3 290") | right edge: **one filled primary verb** (Reply,
Confirm, Send ticket, Extend, Record) + one ghost secondary (Open, Ignore,
Dismiss) + `…`. Keys `1`/`2` as in Linear; a done row leaves with an undo toast;
the detail opens beside the list, not on a new page.

**What moves.** Ops → *System*: health only (mail, bank, scheduler, Loyverse
morning sync, last error, "Run now"), imports collapsed. Bookings-by-status →
chips on the Bookings header. Payments tiles → two (*To confirm*, *Unmatched
credits, 30 d*); table defaults to credits. Booking detail → one action row with
the next sensible step filled, the rest under *Send ▾* and *More ▾*.

**Empty states.** Work view: "Nothing to reply to. Mail is checked every minute;
customer replies land here. → Mail". Today on a closed day: "No groups today.
Next: Sat 31 Oct, 3 groups. → Open day". Calendar closed cells: hatch only.

**Must be true on day one.** Every row has exactly one filled button and it is
always the move-on verb; a label means the same thing everywhere ("Send
proforma" on the queue, the booking and the email history); sidebar counts
equal page counts; Today needs no scrolling; the words are Linda's (Mail, Bank,
Gate, Work), not the system's (Inbox, Ops, Queue, unmatched_emails).

## Sources

- Front: https://help.front.com/en/articles/3889728 · https://help.front.com/t/h429y2
- Help Scout: https://docs.helpscout.com/article/1429-about-default-folder-views-in-help-scout
- Zendesk: https://support.zendesk.com/hc/en-us/articles/4408829483930-Accessing-your-views-of-tickets
- Linear: https://linear.app/docs/triage · https://linear.app/docs/inbox
- Shopify: https://help.shopify.com/en/manual/shopify-admin/shopify-home · https://changelog.shopify.com/posts/improved-admin-navigation
- Stripe: https://docs.stripe.com/dashboard/basics · https://support.stripe.com/questions/dashboard-home-charts-overview
- Mews: https://help.mews.com/s/article/your-dashboard
- Cloudbeds: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/115000400634
- FareHarbor: https://help.fareharbor.com/hc/en-us/articles/40897741234331-Navigating-the-Dashboard · https://help.fareharbor.com/dashboard/self-service-your-dashboard/
- Peek Pro: https://wheelfunrentals.com/peek-set-up-and-use/ · https://www.peekpro.com/support
- Toast: https://support.toasttab.com/en/article/How-do-I-access-sales-reports
- Lightspeed: https://k-series-support.lightspeedhq.com/hc/en-us/articles/36985562334363 · https://k-series-support.lightspeedhq.com/hc/articles/360054950934
- NN/g, dashboards: https://www.nngroup.com/articles/dashboards-preattentive/
- NN/g, empty states: https://www.nngroup.com/articles/empty-state-interface-design/
- Badge rules: https://design.tax.service.gov.uk/hmrc-design-patterns/notification-badge/ · https://www.patternfly.org/components/notification-badge/design-guidelines
