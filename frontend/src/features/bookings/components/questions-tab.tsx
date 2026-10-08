/**
 * Questions tab: what the customer asked, answered inline, then sent in one
 * email from the action bar ("Send answers").
 */

import { Check, MessageSquareText, Plus } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";

import { useAddQuestion, useAnswerQuestion } from "../api";
import type { BookingDetail, BookingQuestion } from "../types";

export function QuestionsTab({ booking, onSendAnswers }: { booking: BookingDetail; onSendAnswers: () => void }) {
  const add = useAddQuestion(booking.id);
  const [question, setQuestion] = useState("");
  const answered = booking.questions.filter((q) => q.answer).length;

  async function submit() {
    const text = question.trim();
    if (!text) return;
    await add.mutateAsync({ question: text });
    setQuestion("");
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Questions"
        description={booking.questions.length ? `${answered} of ${booking.questions.length} answered. Answers are emailed together with “Send answers”.` : "Questions from the request form or the inbox land here."}
        actions={
          <Button size="sm" variant="outline" onClick={onSendAnswers} disabled={answered === 0 || !booking.contact_email} title={!booking.contact_email ? "Add a contact email first" : answered === 0 ? "Answer a question first" : undefined}>
            <Check data-icon="inline-start" />
            Send answers
          </Button>
        }
        flush
      >
        {booking.questions.length === 0 ? (
          <EmptyState compact icon={MessageSquareText} title="No questions yet" />
        ) : (
          <ol className="divide-y divide-border">
            {booking.questions.map((q, index) => (
              <QuestionRow key={q.id} bookingId={booking.id} question={q} index={index + 1} />
            ))}
          </ol>
        )}
      </Section>

      <Section title="Add a question" description="Something they asked by phone or email that deserves a written answer.">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-question">Question</Label>
            <Input id="new-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Can we bring our own braai?" />
          </div>
          <Button type="submit" disabled={!question.trim() || add.isPending}>
            {add.isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            Add
          </Button>
        </form>
      </Section>
    </div>
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
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular" aria-hidden="true">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{question.question}</p>
          <p className="text-xs text-muted-foreground">
            Asked {formatDateTime(question.created_at)}
            {question.answered_at ? ` · answered ${formatDateTime(question.answered_at)}${question.answered_by_name ? ` by ${question.answered_by_name}` : ""}` : ""}
          </p>
        </div>
        {question.answer ? <StatusBadge status="answered" label="Answered" tone="green-muted" /> : <StatusBadge status="open" label="Needs answer" tone="amber" />}
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
                <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(question.answer ?? ""); setEditing(false); }}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm whitespace-pre-wrap">{question.answer}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
