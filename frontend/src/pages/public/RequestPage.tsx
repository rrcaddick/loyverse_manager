/**
 * /request — the customer-facing booking request. No session: it reads
 * GET /public/form-config and POSTs /public/booking-request only.
 */

import { AlertCircle, ArrowRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useFieldArray } from "react-hook-form";
import { useNavigate } from "react-router";

import { CheckboxField, FieldRow, FormError, NumberField, SelectField, TextField, TextareaField, applyApiErrors, useZodForm } from "@/components/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useFormConfig, useSubmitBookingRequest } from "@/features/public/api";
import { buildSchema, emptyValues, type RequestFormOutput } from "@/features/public/schema";
import { Turnstile, type TurnstileHandle } from "@/features/public/turnstile";
import type { FormConfig, RequestSentState } from "@/features/public/types";
import { VisitDateField } from "@/features/public/visit-date-field";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage, isApiError } from "@/lib/api";
import { PARK_NAME } from "@/lib/brand";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function RequestPage() {
  useDocumentTitle("Request a group booking");
  const config = useFormConfig();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{PARK_NAME}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Request a group booking</h1>
        {config.data?.intro ? <p className="max-w-prose text-base text-muted-foreground">{config.data.intro}</p> : config.isPending ? <Skeleton className="h-5 w-3/4" /> : null}
        <ol className="mt-1 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
          {["Tell us about your group and the day you have in mind.", "We check the date and email you a proforma with your reference.", "Your deposit secures the date; the balance is payable on the day."].map((step, i) => (
            <li key={step} className="flex gap-2.5 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10">
              <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </header>

      {config.isPending ? (
        <FormSkeleton />
      ) : config.isError || !config.data ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>The form could not be loaded</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(config.error)}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void config.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <RequestForm config={config.data} />
      )}
    </div>
  );
}

function RequestForm({ config }: { config: FormConfig }) {
  const navigate = useNavigate();
  const schema = useMemo(() => buildSchema(config), [config]);
  const form = useZodForm({ schema, defaultValues: emptyValues() });
  const questions = useFieldArray({ control: form.control, name: "questions" });
  const submit = useSubmitBookingRequest();
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const needsTurnstile = !!config.turnstile_site_key;
  // When the widget itself failed we let the server decide rather than trap the visitor.
  const turnstileBlocksSubmit = needsTurnstile && !turnstileToken && !turnstileError;

  const adults = form.watch("adults");
  const children = form.watch("children");
  const total = (Number.isFinite(adults) ? adults : 0) + (Number.isFinite(children) ? children : 0);

  const groupTypes = config.group_types.map((g) => ({ value: g.code, label: g.label }));

  async function onSubmit(values: RequestFormOutput) {
    setError(null);
    if (turnstileBlocksSubmit) {
      setError("Please complete the verification below before sending.");
      return;
    }
    const payload = {
      group_name: values.group_name,
      group_type: values.group_type,
      area: values.area || undefined,
      contact_name: values.contact_name,
      contact_email: values.contact_email,
      contact_mobile: values.contact_mobile,
      visit_date: values.visit_date,
      alternative_date: values.alternative_date || undefined,
      arrival_time: values.arrival_time || undefined,
      adults: values.adults,
      children: values.children,
      vehicles: values.vehicles,
      gazebos: values.gazebos,
      questions: values.questions.map((q) => q.text).filter(Boolean),
      customer_notes: values.customer_notes || undefined,
      policy_accepted: true as const,
      website: values.website,
      turnstile_token: turnstileToken ?? undefined,
    };
    try {
      const result = await submit.mutateAsync(payload);
      const state: RequestSentState = { ...result, park: config.park };
      navigate("/request/sent", { state, replace: false });
    } catch (err) {
      if (isApiError(err) && err.status === 429) {
        setError("Too many requests have come from this connection in the last hour. Please try again a little later, or phone us.");
      } else if (isApiError(err) && err.code === "turnstile_failed") {
        setError("We could not confirm that you are not a robot. Please complete the verification again and resend.");
        turnstile.current?.reset();
      } else {
        const summary = applyApiErrors(form, err);
        setError(summary ?? "Please check the highlighted fields.");
        if (isApiError(err)) {
          const first = Object.keys(err.fields)[0];
          if (first) form.setFocus(first as never);
        }
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const submitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate className="flex flex-col gap-10">
        <FormError message={error} />

        <Fieldset step={1} title="Your group" description="Who is coming to the park?">
          <TextField control={form.control} name="group_name" label="Group name" required placeholder="e.g. Sunshine Primary Grade 3" autoComplete="organization" maxLength={255} />
          <FieldRow>
            <SelectField control={form.control} name="group_type" label="Kind of group" required options={groupTypes} placeholder="Choose one" />
            <TextField control={form.control} name="area" label="Area or town" placeholder="e.g. Paarl" autoComplete="address-level2" maxLength={255} />
          </FieldRow>
        </Fieldset>

        <Fieldset step={2} title="Contact" description="We email the proforma and booking reference to you.">
          <TextField control={form.control} name="contact_name" label="Your name" required autoComplete="name" maxLength={255} />
          <FieldRow>
            <TextField control={form.control} name="contact_email" label="Email" type="email" required autoComplete="email" placeholder="you@example.com" />
            <TextField control={form.control} name="contact_mobile" label="Mobile" type="tel" required autoComplete="tel" placeholder="082 123 4567" />
          </FieldRow>
        </Fieldset>

        <Fieldset step={3} title="Your visit" description={`The season runs ${formatDate(config.min_date)}${config.max_date ? ` to ${formatDate(config.max_date)}` : ""}.`}>
          <FieldRow>
            <VisitDateField control={form.control} name="visit_date" label="Preferred date" required config={config} description="Weekends and school holidays fill up first." />
            <VisitDateField control={form.control} name="alternative_date" label="Alternative date" config={config} description="Optional: a second choice if your first is full." clearable />
          </FieldRow>
          <FieldRow className="sm:grid-cols-3">
            <TextField control={form.control} name="arrival_time" label="Arrival time" placeholder="e.g. 10:00" maxLength={20} />
            <NumberField control={form.control} name="vehicles" label="Vehicles" integer min={0} description="Buses, taxis and cars." />
            <NumberField control={form.control} name="gazebos" label="Gazebos to hire" integer min={0} description="Shaded spots for your group." />
          </FieldRow>
        </Fieldset>

        <Fieldset step={4} title="Numbers" description={`Group bookings are for ${formatNumber(config.min_group_size)} or more people. A rough number is fine; you can update it later.`}>
          <FieldRow className="sm:grid-cols-3">
            <NumberField control={form.control} name="adults" label="Adults" integer min={0} required placeholder="0" />
            <NumberField control={form.control} name="children" label="Children" integer min={0} required placeholder="0" />
            <div className="flex flex-col justify-end gap-1 pb-1 text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className={cn("text-lg font-semibold tabular", total > 0 && total < config.min_group_size ? "text-destructive" : "text-foreground")} aria-live="polite">
                {formatNumber(total)} {total === 1 ? "person" : "people"}
              </span>
            </div>
          </FieldRow>
        </Fieldset>

        <Fieldset step={5} title="Questions" description={`Anything you would like to know before you book? Up to ${config.max_questions}.`}>
          {questions.fields.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {questions.fields.map((field, index) => (
                <li key={field.id} className="flex items-start gap-2">
                  <TextField control={form.control} name={`questions.${index}.text`} label={`Question ${index + 1}`} hideLabel placeholder="Type your question" className="flex-1" maxLength={500} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove question ${index + 1}`} onClick={() => questions.remove(index)} className="mt-0.5 shrink-0 sm:mt-0">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ol>
          ) : null}
          {questions.fields.length < config.max_questions ? (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => questions.append({ text: "" })}>
                <Plus data-icon="inline-start" />
                {questions.fields.length === 0 ? "Add a question" : "Add another question"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">That is the maximum; anything else can go in the notes.</p>
          )}
        </Fieldset>

        <Fieldset step={6} title="Notes" description="Anything else that helps us plan your day.">
          <TextareaField control={form.control} name="customer_notes" label="Notes" hideLabel rows={4} maxLength={2000} placeholder="Special needs, celebrations, catering plans…" />
        </Fieldset>

        <Fieldset step={7} title="Booking policy">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Your date is held provisionally until the deposit on the proforma is paid; the deposit secures the date.</li>
            <li>The balance is payable on the day, based on the number of people who arrive.</li>
            <li>Card payments are accepted at the gate.</li>
          </ul>
          <CheckboxField control={form.control} name="policy_accepted" label="I have read and accept the booking policy" />
        </Fieldset>

        {/* Honeypot: hidden from people, filled by bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="request-website">Website</label>
          <input id="request-website" type="text" tabIndex={-1} autoComplete="off" {...form.register("website")} />
        </div>

        {needsTurnstile ? (
          <div className="flex flex-col gap-2">
            <Turnstile ref={turnstile} siteKey={config.turnstile_site_key!} onToken={setTurnstileToken} onError={setTurnstileError} />
            {turnstileError ? (
              <p className="text-sm text-muted-foreground" role="status">
                {turnstileError} You can still send the request; we will verify it on our side.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Nothing is charged now. We reply by email, usually within a working day.</p>
          <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            Send request
            {!submitting ? <ArrowRight data-icon="inline-end" /> : null}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function Fieldset({ step, title, description, children }: { step: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-5 border-t border-border pt-6">
      <legend className="float-left mb-1 flex items-center gap-2.5">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular">
          {step}
        </span>
        <span className="text-lg font-semibold text-foreground">{title}</span>
      </legend>
      {description ? <p className="clear-both -mt-2 text-sm text-muted-foreground">{description}</p> : <span className="clear-both" />}
      {children}
    </fieldset>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-4 border-t border-border pt-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
      ))}
    </div>
  );
}
