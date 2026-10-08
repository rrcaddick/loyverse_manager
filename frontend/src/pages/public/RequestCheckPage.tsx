/**
 * /request/check — "Check your answers": the three screens as a summary
 * list with a Change link per row, the booking terms as a declaration (no
 * tick box; `policy_accepted: true` is sent), Turnstile rendered here only
 * (managed, flexible, directly above the button so the 300 s token is
 * minted seconds before use), the honeypot, "Send request" and "Nothing is
 * paid now." Server 422 messages are mapped onto the screen they belong to.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { publicKeys, useSubmitBookingRequest } from "@/features/public/api";
import { ConfigGate } from "@/features/public/config-gate";
import { readBack } from "@/features/public/dates";
import { clearDraft, loadDraft, saveServerErrors } from "@/features/public/draft";
import { focusField } from "@/features/public/a11y";
import type { SummaryError } from "@/features/public/fields";
import { FIELD_STEP, buildPayload, contactSchema, groupSchema, issuesByField, visitSchema } from "@/features/public/schema";
import { StepShell } from "@/features/public/step-shell";
import { Turnstile, type TurnstileHandle } from "@/features/public/turnstile";
import type { FormConfig } from "@/features/public/types";
import { errorMessage, isApiError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The declaration from docs/research/06 — exact wording. */
const POLICY =
  "By sending this request you agree to our booking terms: your date is held once the deposit on the proforma is paid; the balance is paid on the day for the people who actually arrive, so a few more or fewer is fine; card payments are accepted at the gate.";

export default function RequestCheckPage() {
  return <ConfigGate>{(config) => <CheckScreen config={config} />}</ConfigGate>;
}

interface Row {
  field: string;
  label: string;
  value: ReactNode;
  step: "visit" | "group" | "contact";
}

function CheckScreen({ config }: { config: FormConfig }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const submit = useSubmitBookingRequest();
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<SummaryError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const needsTurnstile = !!config.turnstile_site_key;
  const phone = config.park.phone ?? "";

  const draft = useMemo(() => loadDraft(), []);
  const parsed = useMemo(
    () => ({
      visit: visitSchema(config).safeParse(draft),
      group: groupSchema(config).safeParse(draft),
      contact: contactSchema().safeParse(draft),
    }),
    [config, draft],
  );

  // Anything a screen would have refused: listed with a link to that screen.
  const stepErrors = useMemo<SummaryError[]>(() => {
    const out: SummaryError[] = [];
    for (const [step, result] of [
      ["visit", parsed.visit],
      ["group", parsed.group],
      ["contact", parsed.contact],
    ] as const) {
      if (result.success) continue;
      for (const [field, text] of Object.entries(issuesByField(result.error))) {
        out.push({ field, message: text, to: `/request/${step}` });
      }
    }
    return out;
  }, [parsed]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: 0 });
      if (stepErrors.length) summaryRef.current?.focus({ preventScroll: true });
      else headingRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stepErrors.length]);

  // Focus the summary once the errors it lists have been committed to the DOM.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus();
  }, [focusRequest]);

  function focusSummary() {
    setFocusRequest((n) => n + 1);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setServerErrors([]);
    if (!parsed.visit.success || !parsed.group.success || !parsed.contact.success) {
      focusSummary();
      return;
    }
    if (needsTurnstile && !turnstileToken && !turnstileError) {
      setMessage("The check that you are not a robot has not finished yet. Wait a moment, then send again.");
      focusSummary();
      return;
    }
    const payload = {
      ...buildPayload(parsed.visit.data, parsed.group.data, parsed.contact.data),
      website: honeypot.current?.value ?? "",
      turnstile_token: turnstileToken ?? undefined,
    };
    try {
      const result = await submit.mutateAsync(payload);
      clearDraft();
      queryClient.setQueryData(publicKeys.request(result.id), result);
      const token = result.token ? `?token=${encodeURIComponent(result.token)}` : "";
      navigate(`/request/sent/${result.id}${token}`, { replace: true, state: { summary: result } });
    } catch (error) {
      if (isApiError(error) && error.status === 429) {
        setMessage(`Too many requests have come from this connection in the last hour. Try again a little later${phone ? `, or phone us on ${phone}` : ""}.`);
      } else if (isApiError(error) && error.code === "turnstile_failed") {
        setMessage("We could not confirm that you are not a robot. Complete the check again, then send your request.");
        turnstile.current?.reset();
      } else if (isApiError(error) && Object.keys(error.fields).length > 0) {
        const fields = error.fields;
        saveServerErrors(fields);
        setServerErrors(
          Object.entries(fields).map(([field, text]) => {
            const step = FIELD_STEP[field];
            return { field, message: text, to: step ? `/request/${step}` : undefined };
          }),
        );
        turnstile.current?.reset();
      } else {
        setMessage(errorMessage(error, "Something went wrong and your request was not sent. Try again in a moment."));
        turnstile.current?.reset();
      }
      focusSummary();
    }
  }

  const groupLabel = config.group_types.find((g) => g.code === draft.group_type)?.label;
  const visitIso = parsed.visit.success ? parsed.visit.data.visit_date : null;
  const altIso = parsed.visit.success ? parsed.visit.data.alternative_date : null;
  const questions = draft.questions.map((q) => q.trim()).filter(Boolean);

  const rows: Row[] = [
    { field: "visit_date", label: "Preferred date", value: visitIso ? readBack(visitIso, config) : draft.visit_date || <Missing />, step: "visit" },
    { field: "alternative_date", label: "Alternative date", value: altIso ? readBack(altIso, config) : draft.alternative_date || <None text="None" />, step: "visit" },
    { field: "visitors", label: "Visitors", value: draft.visitors ? formatNumber(draft.visitors) : <Missing />, step: "visit" },
    { field: "arrival_time", label: "Arrival time", value: draft.arrival_time || <None text="Not given" />, step: "visit" },
    { field: "group_name", label: "Group name", value: draft.group_name || <Missing />, step: "group" },
    { field: "group_type", label: "Kind of group", value: groupLabel ?? <Missing />, step: "group" },
    { field: "area", label: "Area or town", value: draft.area || <None text="Not given" />, step: "group" },
    { field: "vehicles", label: "Vehicles", value: draft.vehicles || <None text="Not given" />, step: "group" },
    { field: "gazebos", label: "Gazebos to hire", value: draft.gazebos || <None text="None" />, step: "group" },
    {
      field: "questions-0",
      label: "Questions for us",
      value:
        questions.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        ) : (
          <None text="None" />
        ),
      step: "group",
    },
    { field: "customer_notes", label: "Anything else", value: draft.customer_notes ? <span className="whitespace-pre-line">{draft.customer_notes}</span> : <None text="Nothing" />, step: "group" },
    { field: "contact_name", label: "Your name", value: draft.contact_name || <Missing />, step: "contact" },
    { field: "contact_email", label: "Email", value: draft.contact_email ? <span className="break-all">{draft.contact_email}</span> : <Missing />, step: "contact" },
    { field: "contact_mobile", label: "Mobile", value: draft.contact_mobile ? <span className="tabular">{draft.contact_mobile}</span> : <Missing />, step: "contact" },
  ];

  const groups: { title: string; step: Row["step"] }[] = [
    { title: "Your visit", step: "visit" },
    { title: "Your group", step: "group" },
    { title: "How we reach you", step: "contact" },
  ];

  return (
    <StepShell
      step="check"
      title="Check your answers"
      backTo="/request/contact"
      errors={[...stepErrors, ...serverErrors]}
      message={message}
      summaryRef={summaryRef}
      headingRef={headingRef}
      onSubmit={(event) => void onSubmit(event)}
      submitLabel="Send request"
      submitting={submit.isPending}
      beforeSubmit={
        <div className="flex flex-col gap-4">
          <p className="max-w-prose text-[1rem] leading-6 text-foreground">{POLICY}</p>
          {/* Honeypot: hidden from people, filled by bots. */}
          <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="request-website">Website</label>
            <input id="request-website" name="website" ref={honeypot} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
          {needsTurnstile ? (
            <div className="flex flex-col gap-2">
              <div className={cn(turnstileError && "hidden")}>
                <Turnstile ref={turnstile} siteKey={config.turnstile_site_key!} onToken={setTurnstileToken} onError={setTurnstileError} />
              </div>
              {turnstileError ? (
                <p className="text-sm text-muted-foreground" role="status">
                  The check that you are not a robot could not load. Refresh the page to try again{phone ? `, or phone us on ${phone}` : ""}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      }
      afterSubmit={<p className="text-center text-sm text-muted-foreground">Nothing is paid now.</p>}
    >
      {groups.map((group) => (
        <section key={group.step} aria-labelledby={`check-${group.step}`} className="flex flex-col gap-2">
          <h2 id={`check-${group.step}`} className="text-section text-foreground">
            {group.title}
          </h2>
          <dl className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
            {rows
              .filter((row) => row.step === group.step)
              .map((row) => (
                <div key={row.field} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
                  <dt className="text-sm text-muted-foreground sm:pt-0.5">{row.label}</dt>
                  <dd className="row-start-2 text-[1rem] leading-6 text-foreground sm:row-start-auto">{row.value}</dd>
                  <dd className="row-span-2 self-start sm:row-span-1">
                    <Link
                      to={`/request/${row.step}`}
                      state={{ focus: row.field }}
                      onClick={() => window.setTimeout(() => focusField(row.field), 0)}
                      className="inline-flex min-h-11 items-center text-[1rem] font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Change<span className="sr-only"> {row.label.toLowerCase()}</span>
                    </Link>
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </StepShell>
  );
}

function Missing() {
  return <span className="font-medium text-red-text">Not answered</span>;
}

function None({ text, className }: { text: string; className?: string }) {
  return <span className={cn("text-muted-foreground", className)}>{text}</span>;
}
