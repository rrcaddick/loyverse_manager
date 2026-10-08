/** /request/sent — confirmation after the public form, fed by router state. */

import { CheckCircle2, Mail, Phone } from "lucide-react";
import { Link, useLocation } from "react-router";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import type { RequestSentState } from "@/features/public/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PARK_CONTACT, PARK_NAME } from "@/lib/brand";
import { formatDateLong } from "@/lib/format";

export default function RequestSentPage() {
  useDocumentTitle("Request sent");
  const location = useLocation();
  const state = (location.state ?? null) as RequestSentState | null;
  const park = state?.park ?? null;
  const phone = park?.phone || PARK_CONTACT.phone;
  const email = park?.email || PARK_CONTACT.email;
  const name = park?.name || PARK_NAME;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 aria-hidden="true" className="size-6" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{state ? "Thank you, we have your request" : "Your request was sent"}</h1>
        <p className="max-w-prose text-base text-muted-foreground">
          {state ? (
            <>
              We will look at <span className="font-medium text-foreground">{formatDateLong(state.visit_date)}</span> for{" "}
              <span className="font-medium text-foreground">{state.group_name}</span> and reply to{" "}
              <span className="font-medium text-foreground">{state.contact_email}</span>.
            </>
          ) : (
            "We will reply by email with a proforma and your booking reference."
          )}
        </p>
      </header>

      {state ? (
        <section aria-labelledby="reference-heading" className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 id="reference-heading" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Your booking reference
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-3xl font-semibold tracking-tight text-foreground">{state.reference}</span>
            <CopyButton value={state.reference} label="Copy" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Quote it when you phone or pay, so we can find your booking straight away.</p>
        </section>
      ) : null}

      <section aria-labelledby="next-heading" className="flex flex-col gap-3">
        <h2 id="next-heading" className="text-lg font-semibold text-foreground">
          What happens next
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            { title: "We review the date", body: "The team checks availability and the numbers you gave us." },
            { title: "You receive a proforma", body: "It arrives by email with the price, the deposit and our banking details." },
            { title: "The deposit secures the date", body: "Pay the deposit by EFT; the balance is payable on the day, by card at the gate if you like." },
          ].map((step, i) => (
            <li key={step.title} className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="font-medium text-foreground">{step.title}</span>
              <span className="text-sm text-muted-foreground">{step.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="contact-heading" className="flex flex-col gap-2">
        <h2 id="contact-heading" className="text-lg font-semibold text-foreground">
          Need to reach us sooner?
        </h2>
        <p className="text-sm text-muted-foreground">{name} is happy to help with anything about your visit.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <a href={`tel:${phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-2 text-foreground underline-offset-4 hover:underline">
            <Phone aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="tabular">{phone}</span>
          </a>
          <a href={`mailto:${email}`} className="inline-flex items-center gap-2 text-foreground underline-offset-4 hover:underline">
            <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
            {email}
          </a>
        </div>
      </section>

      <div>
        <Button asChild variant="outline">
          <Link to="/request">Send another request</Link>
        </Button>
      </div>
    </div>
  );
}
