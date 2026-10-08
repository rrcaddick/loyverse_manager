/**
 * The frame every screen of the public form shares — "Step 1 of 3", the
 * Back link, a heading that takes focus on arrival, the error summary above
 * the heading, one intro line, the fields and a full-width Continue.
 * `useStepForm` (use-step-form.ts) wires a screen's form to the draft.
 */

import { ArrowLeft } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { ErrorSummary, type SummaryError } from "./fields";

export const STEP_COUNT = 3;

/** The one line under the title (docs/research/06, "Recommendation for ours"). */
export const INTRO_LINE = "We reply by email within one working day with a proforma; nothing is paid now.";

interface StepShellProps {
  /** 1–3 for the question screens; "check" for the summary. */
  step: 1 | 2 | 3 | "check";
  title: string;
  /** Shown under the title. */
  intro?: ReactNode;
  backTo?: string;
  errors?: SummaryError[];
  message?: string | null;
  summaryRef?: RefObject<HTMLDivElement | null>;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  submitLabel?: string;
  submitting?: boolean;
  /** Rendered between the fields and the button (Turnstile on Check). */
  beforeSubmit?: ReactNode;
  /** Rendered under the button ("Nothing is paid now."). */
  afterSubmit?: ReactNode;
  children: ReactNode;
}

export function StepShell({ step, title, intro, backTo, errors = [], message, summaryRef, headingRef, onSubmit, submitLabel = "Continue", submitting, beforeSubmit, afterSubmit, children }: StepShellProps) {
  useDocumentTitle(step === "check" ? "Check your answers" : `${title} · Step ${step} of ${STEP_COUNT}`);
  const caption = step === "check" ? "Check your answers" : `Step ${step} of ${STEP_COUNT}`;
  const body = (
    <>
      {backTo ? (
        <Link to={backTo} className="inline-flex min-h-11 items-center gap-1.5 self-start text-[1rem] font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back
        </Link>
      ) : null}
      <ErrorSummary ref={summaryRef} errors={errors} message={message} />
      <header className="flex flex-col gap-2">
        {step !== "check" ? <p className="text-label text-muted-foreground uppercase">{caption}</p> : null}
        <h1 ref={headingRef} tabIndex={-1} className="text-title text-foreground outline-none">
          {title}
        </h1>
        {intro ? <p className="max-w-prose text-[1rem] leading-6 text-muted-foreground">{intro}</p> : null}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
      {beforeSubmit}
      {onSubmit ? (
        <div className="flex flex-col gap-3">
          <Button type="submit" size="lg" disabled={submitting} className="h-12 w-full text-[1rem]">
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            {submitLabel}
          </Button>
          {afterSubmit}
        </div>
      ) : null}
    </>
  );
  return onSubmit ? (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      {body}
    </form>
  ) : (
    <div className="flex flex-col gap-6">{body}</div>
  );
}
