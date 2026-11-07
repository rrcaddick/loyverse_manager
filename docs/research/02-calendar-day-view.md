# 02 · Calendar availability views and the operations day view

Screenshots: `data/screenshots/research/cal-*.png`, taken 2026-10-08 from the current
build.

## Who and what for

**The operator** keeps the calendar open all day and, with a customer on the phone, asks
it: *how heavy is that Saturday already, and how much of it is real?* The cell must
answer without hover, click or squint. *Which groups?* belongs in a side panel. *What
does the next fortnight look like across the month boundary?* is why she wants to scroll
by week, not page by month.

**The manager at the gate** looks ahead on the calendar and works the day on the day
view: who is coming, when, how many, who has arrived. Tablet, outdoors, hurried. Money is
not his job.

The data: season October–April, closed Monday and Tuesday, peak days, 10–900 people per
group, up to a dozen groups on a December Saturday, a capacity warning at 1 000 people.

## What the best products do

**Mews.** The dashboard is a row of "donuts", each "a summary of the day along with
items that require your action". Its work screen is the *Reservation overview*:
Arrivals / Departures tabs, counters for *Reservations* and *Customers* above a card
list, labels per card ("To check in", "Checked in online"); checked-in cards drop to a
lower section. Occupancy bars are blue and turn orange only for overbooking — one
colour, one meaning.

**Cloudbeds.** The dashboard opens on an *activity bar* of today's counts with
prev/today/next arrows. On the calendar, selecting a booking opens a right-hand panel
"that keeps the grid in view" with dates, party size, expected arrival time, total and
outstanding; a red marker means money owed, yellow a note.

**Opera Cloud / Guestline.** Opera's Property Availability grid is numbers, not colour:
1, 7 or 28 day columns "depending on the workstation resolution". Guestline Rezlynx adds occupancy bands (green → yellow → orange → red by
% occupancy) set once "for your whole site and all users": fixed thresholds, shared
meaning.

**Restaurants and venues.** Resy OS works a day as a per-table timeline and lets
pacing "turn red at capacity". SevenRooms' grid shows "an entire shift at once".
TableCheck's weekly view shows, per day, counts of reservations and of people — the
closest published analogue to our cell. ROLLER (attractions) has a *Daily capacity*
screen: a row per resource, each slot shows guests booked and spaces remaining, "show
redemptions" overlays tickets redeemed at POS against expected, and a slot opens a side
panel.

**Tour and attraction software.** FareHarbor's *manifest* is "a day-specific view of
your items, availabilities, and bookings" filterable by check-in status or headcount;
each row has a check-in column, "once the party has been checked in, the row will be
highlighted in green", and Shift+number sets a status. Xola's dashboard list shows
time, product, reserved and available spots and "how many guests are checked in";
check-in is a green button, no-show a red one. In Checkfront, "clicking on a date
square, rather than a customer's name" opens a window listing the day's bookings with a
footer giving "the total bookings for the day, the total quantity booked and the total
value". Bookeo's agenda is *Today / 3 days / 7 days*; Peek Pro's mobile
manifest is a day list filtered by guide or time.

**Generic calendars.** Google Calendar pages months ("it's just how they designed it",
per a Google specialist); extensions exist purely to step a week at a time. Fantastical
has "Weeks in month view", "Start month view on … the current/selected week" and a
*Text size* setting. Notion Calendar: `T` = today, `J`/`K` = next/previous unit.
Teamup's multi-week view shows 1–53 weeks, "keeps the current week at the top", scrolls
across weeks and shades alternate months.

**Heat maps.** GitHub's five shades are "quartiles after removing outliers" relative to
the days displayed, so a record day "will become the darkest shade and all of the other
days will become lighter". Wrong for us: our colour must mean
the same headcount in March as in December. Datawrapper: a sequential ramp needs "a big
lightness range"; text on it needs 4.5:1, graphics 3:1.

## Principles that transfer

1. One big number per cell; everything else subordinate.
2. Colour encodes one quantity on a fixed scale with a numeric legend; never relative.
3. Certainty (confirmed vs pending) is a bar, not a second fill.
4. Names in the panel, totals in the cell.
5. The grid never leaves the screen: panels and drawers, no modals.
6. Time is continuous: scroll by week, today near the top.
7. The day screen is a list with a check-in column and a green row state.
8. Today is one keystroke and one click from anywhere.

## Critique of our current build

`cal-nov-1440x900.png`, `cal-dec-full-1440x900.png`, `cal-nov-1920x1080.png`: the grid
is 902 px tall from y = 224, so the page is 1 215 px at 1440×900 and 1 191 px at
1920×1080 — it scrolls at both sizes; the last row and the legend sit below the fold.
144 px of viewport go to title, description and toolbar. Cells are 134×144 (1440) /
200×144 (1920), yet the primary numbers ("167 / 368", "5 grps") are 12 and 11 px,
muted, at the bottom edge, under three 11 px name chips and "+2 more": the eye lands on
names. The 1 px split bar vanishes on dark cells. The week column sets *confirmed* in
18 px bold and *interest* ("of 668 people") in 12 px grey — the inverse of the
requirement. Heat step 5 (L 0.45) flips text to white, so 21 Nov and 5 Dec read as a
different kind of cell, not a darker one. The legend is 12 px, seven encodings, last on
the page. A booking on a closed Monday (2 Nov, 300 people) shows hatch plus heat
unexplained. Navigation is month-only; neither role has a Today
item in the sidebar.

`cal-nov-panel-7nov-1440x900.png`: the Sheet is modal and dims the grid, so the context
just read disappears. The content is right, but the stats are 18 px, there is no bar,
and arrival time is missing.

`cal-day-7nov-full-1440x900.png`: four 24 px tiles, then five ~165 px cards each with
four mini-tiles and three buttons — 15 buttons and 20 tiles for five groups, 1 243 px
tall. "Vehicle ticket not sent" is a full line per card. Nothing is sorted by arrival
time; nothing changes visibly once a group has arrived.

## Recommendation for ours

**Viewport fit.** `/calendar` is a flex column of `calc(100dvh − 56px)`: toolbar 44 px,
column headers 24 px, grid, legend line 28 px. Drop the page title and description.
Collapse the sidebar to a 56 px icon rail on this route. Rows: `repeat(N, minmax(104px, 1fr))`, N = 6 at 1440×900 (row 119 px),
7 at 1920×1080 (row 128 px), 5 below 720 px tall. Day cells: **168×119 px at 1440×900**
(139 wide with the sidebar pinned open), **234×128 px at 1920×1080** (206 pinned). Week
column 128 / 144 px. Gaps 6 px.

**Cell anatomy** (padding 8 px, top → bottom):

- Row 1, 18 px: day number 14 px/600 tabular, left; today = 22 px filled primary disc
  with a white number. Right: at most one 10 px uppercase tag — `CLOSED`, `PEAK`,
  `AVOID`, or the holiday label truncated; closed = hatch over the cell; avoid = dashed
  border; peak = tag plus a 2 px amber top rule. The first of a month reads "1 Dec".
- Row 2: **interest** (confirmed + pending) 30 px/700 tabular, line-height 32 (36 px at
  1920); on its baseline to the right, "9 grps" 12 px/500 muted. Empty open days show
  the day number only.
- Row 3, 28 px: the **split bar**, 6 px tall, radius 3, full width, denominator =
  interest so it is always full: confirmed solid primary green, pending in the status
  badges' amber. Below it, 12 px tabular: `550 · 250`
  with 6 px swatches at ≤139 px width, `550 confirmed · 250 pending` at ≥168 px. Over
  capacity: 3 px red top rule and an `OVER` tag instead of the red dot.

**Heat ramp rule.** Fill = interest on five fixed bands anchored to the capacity
setting C: 1–9 %, 10–24 %, 25–49 %, 50–74 %, ≥75 % of C (C = 1 000: 1–99, 100–249,
250–499, 500–749, 750+). Lightness 0.95 / 0.89 / 0.81 / 0.72 / 0.62 at hue 150 (dark
mode 0.28→0.52), so ink text keeps ≥4.5:1 on every step: no white-text flip, no bar
inversion. Never month-relative. Legend: six swatches labelled `0 100 250 500 750`.

**Week column.** No heat; right-aligned stack: interest 24 px/700 (28 at 1920) +
"people" 11 px, "9 groups" 12 px, the same 6 px bar, `550 · 250` 12 px. Its background
alternates faintly by month so a two-month window reads as two months.

**Navigation.** Toolbar: `Today` · `‹` `›` (month) · "November 2026" (or "Nov – Dec
2026"; click = month picker) · `▲` `▼` (week) · right: totals for
the visible weeks. State is `?from=<Monday>`; `‹›` set it to the Monday on or before the
1st; `▲▼` and the wheel over the grid move one week; `Today` puts today's week in row 2.
Keys: arrows move focus, PgUp/PgDn month, `T` today, Enter opens. Never dim out-of-month
days — they are the point of the window.

**Side panel.** 400 px (440 at 1920), non-modal, no scrim, grid stays live; clicking
another day swaps it, Esc closes. Content: date 18 px/600 + relative day + flags; the
cell's numbers at full size (interest 32 px, groups, 8 px bar, confirmed / pending);
then one 56 px row per group: name 14 px/600 with status dot, people 16 px tabular
right, second line `arrives 10:00 · Church group · FY1678`, admin-only balance in red
when due. Sort by arrival time, then size. Footer: *Open day view*, *Add booking*.

**Day view.** Header strip: `‹ Saturday 7 November ›` · Today · Calendar · Add booking,
flags beneath. Three tiles (Expected 5 groups / 368 people; Arrived 0 of 167; Still to
come); admin adds Outstanding. Then a **table**, not cards: Group (name, ref, type
12 px), Expected (people + arrival time), Arrived (count, source, inline *Enter*),
Balance (admin), Status; one `⋯` menu per row for Fetch from Loyverse / Enter arrivals /
Record gate payment / Open booking. Rows 56 px, sorted by arrival time; arrived rows
tinted the lightest green (FareHarbor); ticket-not-sent becomes an icon with a tooltip.

**Today entry.** `Today` is the first sidebar item for both roles (`/day/today` →
redirect to the SAST date) and the manager's landing page; `T` works on both views.

**Manager role.** Same cells; panel and day view minus money; 44 px touch targets; no
hover-only affordances; the rail shows Today and Calendar.

## Sources

- Mews: https://help.mews.com/s/article/your-dashboard ·
  https://help.mews.com/s/article/reservation-overview?language=en_US ·
  https://help.mews.com/en/articles/4245880-occupancy-report
- Cloudbeds: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/115000400634 ·
  https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48372183498907-Getting-Started-with-the-New-Cloudbeds-Calendar
- Opera Cloud: https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.4/ocsuh/t_availability_viewing_room_availabillity.htm
- Guestline Rezlynx: https://help-guestline.theaccessgroup.com/en/articles/13116759-guestline-rezlynx-availability-screen-colours-overview
- Resy OS: https://helpdesk.resy.com/en_us/availability-and-pacing-updates-S1T3bPXLd ·
  https://helpdesk.resy.com/how-to-make-single-day-edits-to-table-availability-in-resyos-app-r1nkGP7Ud
- SevenRooms: https://sevenrooms.com/platform/table-management/
- TableCheck: https://support-restaurants.tablecheck.com/hc/en-us/articles/34019984856345-Calendar-View-Legend
- ROLLER: https://academy.roller.software/manage-bookings-in-venue-manager/manage-daily-bookings-in-venue-manager
- FareHarbor: https://help.fareharbor.com/hc/en-us/articles/42957683138459-FareHarbor-Glossary ·
  https://help.fareharbor.com/hc/en-us/articles/40897710461851-Using-the-manifest-to-view-pickup-routes ·
  https://help.fareharbor.com/getting-started/keyboard-shortcuts
- Xola: https://support.xola.com/xola-dashboard · https://support.xola.com/check-in-preferences
- Checkfront: https://support.checkfront.com/hc/en-us/articles/19868404494748-Gaining-booking-insights-from-the-Booking-Calendar ·
  https://support.checkfront.com/hc/en-us/articles/115004320374-Introduction-to-the-Booking-Calendar
- Bookeo: https://support.bookeo.com/hc/en-us/articles/13254623200013-The-Agenda-section-of-your-dashboard
- Peek Pro: https://www.peekpro.com/solutions/tour-operator-software
- Google Calendar: https://support.google.com/calendar/answer/6110849 ·
  https://support.google.com/calendar/thread/733174/why-no-smooth-vertical-scrolling-in-calendar-month-or-multi-week-view
- Fantastical: https://flexibits.com/fantastical/help/settings ·
  https://flexibits.com/blog/2022/07/hows-the-view-from-here-getting-the-most-out-of-fantasticals-calendar-views/
- Notion Calendar: https://www.notion.com/help/notion-calendar-keyboard-shortcuts
- Teamup: https://www.teamup.com/learn/calendar-visualization/stay-current-and-scroll-through-months-with-multi-week-view/
- GitHub contributions: https://github.community/t/the-color-coding-of-contribution-graph-is-showing-wrong-information/18572
- Datawrapper colours: https://www.datawrapper.de/blog/colors-for-data-vis-style-guides
