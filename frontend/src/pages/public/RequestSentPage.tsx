/**
 * /request/sent/:id?token= — the confirmation. Fetches the public summary
 * with the signed token so the page survives a refresh: a green "Request
 * sent" panel with the reference large and a copy button, "We have emailed
 * a copy to …" only when the acknowledgement was sent, a dated reply
 * promise (closed Mondays and Tuesdays wording), the three next steps,
 * phone, email and a WhatsApp link.
 */

import { CheckCircle2, Mail, MessageCircle, Phone } from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormConfig, useRequestSummary } from "@/features/public/api";
import { closedWeekdayNames, fullDate, replyByDate, weekdayDate } from "@/features/public/dates";
import type { RequestSummary } from "@/features/public/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PARK_CONTACT, PARK_NAME } from "@/lib/brand";
import { WEEKDAYS, formatNumber, toE164Digits } from "@/lib/format";

const NEXT_STEPS = [
  { title: "We check the date", body: "The team looks at availability and the numbers you gave us." },
  { title: "You receive a proforma", body: "It comes by email with the price, the deposit and our banking details." },
  { title: "The deposit secures the date", body: "Pay the deposit by EFT; the balance is paid on the day for the people who arrive." },
];

export default function RequestSentPage() {
  useDocumentTitle("Request sent");
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const token = params.get("token");
  const location = useLocation();
  const seeded = (location.state as { summary?: RequestSummary } | null)?.summary;
  const config = useFormConfig();
  const summary = useRequestSummary(id, token, seeded && String(seeded.id) === id ? seeded : undefined);

  const park = config.data?.park;
  const phone = park?.phone || PARK_CONTACT.phone;
  const email = park?.email || PARK_CONTACT.email;
  const name = park?.name || PARK_NAME;
  const closedWeekdays = config.data?.closed_weekdays ?? [0, 1];

  if (!id || !token) return <Unavailable phone={phone} email={email} name={name} reason="This page needs the link from the form." />;
  if (summary.isPending) return <SentSkeleton />;
  if (summary.isError || !summary.data) {
    return <Unavailable phone={phone} email={email} name={name} reason="This link has expired or is not valid. Your request was still received; our reply comes by email." />;
  }
  const data = summary.data;
  const replyBy = replyByDate(data.submitted_at, closedWeekdays);
  const closedRun = closedRunSentence(closedWeekdays);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="sent-title" className="rounded-xl bg-green-solid px-5 py-6 text-on-solid">
        <div className="flex items-center gap-3">
          <CheckCircle2 aria-hidden="true" className="size-8 shrink-0" />
          <h1 id="sent-title" className="text-title">
            Request sent
          </h1>
        </div>
        <p className="mt-5 text-label uppercase opacity-90">Your reference</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-display tabular">{data.reference}</span>
          <CopyButton value={data.reference} label="Copy" className="h-9 border-on-solid/60 bg-transparent text-on-solid hover:bg-on-solid/15 hover:text-on-solid" />
        </div>
        <p className="mt-3 max-w-prose text-[1rem] leading-6">Quote it when you phone or pay, so we find your booking straight away.</p>
      </section>

      <section aria-labelledby="reply-title" className="flex flex-col gap-2">
        <h2 id="reply-title" className="text-section text-foreground">
          What happens now
        </h2>
        {data.acknowledged ? (
          <p className="text-[1rem] leading-6 text-foreground">
            We have emailed a copy of your answers and this reference to <span className="font-medium">{data.contact_email}</span>.
          </p>
        ) : null}
        <p className="max-w-prose text-[1rem] leading-6 text-foreground">
          We reply by email to <span className="font-medium">{data.contact_email}</span> within one working day, so expect to hear from us by{" "}
          <span className="font-medium">{weekdayDate(replyBy)}</span>.{closedRun ? ` ${closedRun}` : ""}
        </p>
      </section>

      <section aria-labelledby="summary-title" className="flex flex-col gap-2">
        <h2 id="summary-title" className="text-section text-foreground">
          What you asked for
        </h2>
        <dl className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
          {[
            { label: "Group", value: data.group_name },
            { label: "Date", value: fullDate(data.visit_date) },
            { label: "Visitors", value: formatNumber(data.visitors) },
          ].map((row) => (
            <div key={row.label} className="grid min-h-11 gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
              <dt className="text-sm text-muted-foreground sm:pt-0.5">{row.label}</dt>
              <dd className="text-[1rem] leading-6 text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="next-title" className="flex flex-col gap-3">
        <h2 id="next-title" className="text-section text-foreground">
          The next three steps
        </h2>
        <ol className="flex flex-col gap-3">
          {NEXT_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3 rounded-xl bg-card p-4 ring-1 ring-border">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular">
                {i + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[1rem] font-medium text-foreground">{step.title}</span>
                <span className="text-sm text-muted-foreground">{step.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ContactBlock phone={phone} email={email} name={name} />

      <div>
        <Button asChild variant="outline" className="h-11 w-full text-[1rem] sm:w-auto">
          <Link to="/request/visit">Send another request</Link>
        </Button>
      </div>
    </div>
  );
}

/** "We are closed on Mondays and Tuesdays, so a request sent on a Sunday is answered on the Wednesday." */
function closedRunSentence(closedWeekdays: number[]): string | null {
  if (closedWeekdays.length === 0) return null;
  const sorted = [...closedWeekdays].sort((a, b) => a - b);
  const names = closedWeekdayNames({ closed_weekdays: sorted });
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const contiguous = sorted.every((d, i) => d === first + i);
  if (!contiguous) return `We are closed on ${names}.`;
  const before = WEEKDAYS[(first + 6) % 7]!.label;
  const after = WEEKDAYS[(last + 1) % 7]!.label;
  return `We are closed on ${names}, so a request sent on a ${before} is answered on the ${after}.`;
}

function ContactBlock({ phone, email, name }: { phone: string; email: string; name: string }) {
  const digits = toE164Digits(phone);
  return (
    <section aria-labelledby="contact-title" className="flex flex-col gap-2">
      <h2 id="contact-title" className="text-section text-foreground">
        Need to reach us sooner?
      </h2>
      <p className="text-sm text-muted-foreground">{name} is happy to help with anything about your visit.</p>
      <ul className="flex flex-col gap-1 text-[1rem]">
        <li>
          <a href={`tel:+${digits}`} className="inline-flex min-h-11 items-center gap-2 text-foreground underline-offset-4 hover:underline">
            <Phone aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="tabular">{phone}</span>
          </a>
        </li>
        <li>
          <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 text-foreground underline-offset-4 hover:underline">
            <MessageCircle aria-hidden="true" className="size-4 text-muted-foreground" />
            WhatsApp us
          </a>
        </li>
        <li>
          <a href={`mailto:${email}`} className="inline-flex min-h-11 items-center gap-2 break-all text-foreground underline-offset-4 hover:underline">
            <Mail aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            {email}
          </a>
        </li>
      </ul>
    </section>
  );
}

function Unavailable({ phone, email, name, reason }: { phone: string; email: string; name: string; reason: string }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-title text-foreground">Your request was sent</h1>
        <p className="max-w-prose text-[1rem] leading-6 text-muted-foreground">{reason}</p>
      </header>
      <ContactBlock phone={phone} email={email} name={name} />
      <div>
        <Button asChild variant="outline" className="h-11 w-full text-[1rem] sm:w-auto">
          <Link to="/request/visit">Send another request</Link>
        </Button>
      </div>
    </div>
  );
}

function SentSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
