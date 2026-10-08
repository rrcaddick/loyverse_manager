/**
 * Questions from the request form or the inbox, answered inline and sent in
 * one email ("Send answers"). Rendered only when the booking has questions.
 */

import { Check, MessageSquareText, Plus } from "lucide-react";
import { useState } from "react";

import { SectionHeader } from "@/components/section-header";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatNumber } from "@/lib/format";

import { availability } from "../actions";
import { useAddQuestion, useAnswerQuestion } from "../api";
import type { BookingDetail, BookingQuestion } from "../types";
import { useBookingActions } from "../use-booking-actions";

export function QuestionsCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const add = useAddQuestion(booking.id);
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const answered = booking.questions.filter((q) => q.answer).length;
  const unanswered = booking.questions.length - answered;
  const send = availability(booking, "send-answers");

  async function submit() {
    const text = question.trim();
    if (!text) return;
    await add.mutateAsync({ question: text });
    setQuestion("");
    setAdding(false);
  }

  const sendButton = (
    <Button size="sm" variant={unanswered === 0 && send.enabled ? "default" : "outline"} disabled={!send.enabled} onClick={() => actions.send("send-answers")}>
      <Check data-icon="inline-start" />
      Send answers
    </Button>
  );

  return (
    <section className="rounded-xl bg-card ring-1 ring-border" aria-labelledby="questions-title">
      <div className="px-card pt-4">
        <SectionHeader
          id="questions-title"
          icon={MessageSquareText}
          tone={unanswered > 0 ? "amber" : "green"}
          title="Questions"
          count={booking.questions.length}
          description={`${formatNumber(answered)} of ${formatNumber(booking.questions.length)} answered. Answers go out together in one email.`}
          actions={
            send.enabled ? (
              sendButton
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-selection-ring">
                    {sendButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{send.reason}</TooltipContent>
              </Tooltip>
            )
          }
        />
      </div>
      <ol className="divide-y divide-border">
        {booking.questions.map((q, index) => (
          <QuestionRow key={q.id} bookingId={booking.id} question={q} index={index + 1} />
        ))}
      </ol>
      <div className="border-t border-border px-card py-3">
        {adding ? (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-question">Question</Label>
              <Input id="new-question" autoFocus value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Can we bring our own braai?" />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!question.trim() || add.isPending}>
                {add.isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                Add
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add a question they asked by phone or email
          </Button>
        )}
      </div>
    </section>
  );
}

function QuestionRow({ bookingId, question, index }: { bookingId: number; question: BookingQuestion; index: number }) {
  const answer = useAnswerQuestion(bookingId);
  const [editing, setEditing] = useState(!question.answer);
  const [draft, setDraft] = useState(question.answer ?? "");
  const id = `answer-${question.id}`;

  async function save() {
    const text = draft.trim();
    if (!text) return;
    await answer.mutateAsync({ questionId: question.id, answer: text });
    setEditing(false);
  }

  return (
    <li className="flex flex-col gap-3 px-card py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-nested text-xs font-semibold tabular text-muted-foreground" aria-hidden="true">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-foreground">{question.question}</p>
          <p className="text-sm text-muted-foreground">
            Asked {formatDateTime(question.created_at)}
            {question.answered_at ? ` · answered ${formatDateTime(question.answered_at)}${question.answered_by_name ? ` by ${question.answered_by_name}` : ""}` : ""}
          </p>
        </div>
        {question.answer ? <StatusPill tone="green-muted" label="Answered" /> : <StatusPill tone="amber" label="Needs answer" />}
      </div>
      <div className="pl-9">
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Label htmlFor={id} className="sr-only">
              Answer to question {index}
            </Label>
            <Textarea id={id} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type the answer the customer will receive" />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={!draft.trim() || answer.isPending}>
                {answer.isPending ? <Spinner data-icon="inline-start" /> : null}
                Save answer
              </Button>
              {question.answer ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(question.answer ?? "");
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="text-body whitespace-pre-wrap text-foreground">{question.answer}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
