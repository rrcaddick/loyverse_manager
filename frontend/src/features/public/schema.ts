/**
 * Per-screen validation for the public request form. The schemas take the
 * draft's string values (what the text boxes hold) and produce the typed
 * payload; the server stays authoritative and its 422 messages are mapped
 * back onto the same field names (see draft.ts and the Check screen).
 *
 * Wording follows docs/research/06: no "please", no "invalid", the same
 * sentence inline and in the error summary.
 */

import { z } from "zod";

import { dateProblem, parseDmy } from "./dates";
import type { BookingRequestInput, FormConfig } from "./types";

export const STEPS = ["visit", "group", "contact"] as const;
export type Step = (typeof STEPS)[number];

/** Which screen each field lives on (server 422 keys included). */
export const FIELD_STEP: Record<string, Step> = {
  visit_date: "visit",
  alternative_date: "visit",
  visitors: "visit",
  adults: "visit",
  children: "visit",
  arrival_time: "visit",
  group_name: "group",
  group_type: "group",
  area: "group",
  vehicles: "group",
  gazebos: "group",
  questions: "group",
  customer_notes: "group",
  contact_name: "contact",
  contact_email: "contact",
  contact_mobile: "contact",
};

const WHOLE = /^\d+$/;
const PHONE = /^\+?[\d\s()./-]{9,24}$/;

function wholeNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "");
  return WHOLE.test(s) ? Number(s) : null;
}

/** A typed date: "" (when optional) or dd/mm/yyyy that the park can take. */
function dateField(config: FormConfig, required: boolean) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!value) {
        if (required) ctx.addIssue({ code: "custom", message: "Enter your preferred date" });
        return;
      }
      const iso = parseDmy(value);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Enter the date as dd/mm/yyyy, for example 07/11/2026" });
        return;
      }
      const problem = dateProblem(iso, config);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .transform((value) => (value ? (parseDmy(value) ?? "") : ""));
}

export function visitSchema(config: FormConfig) {
  const phone = config.park.phone ? ` on ${config.park.phone}` : "";
  return z
    .object({
      visit_date: dateField(config, true),
      alternative_date: dateField(config, false),
      visitors: z
        .string()
        .trim()
        .superRefine((value, ctx) => {
          if (!value) {
            ctx.addIssue({ code: "custom", message: "Enter how many visitors are coming" });
            return;
          }
          const n = wholeNumber(value);
          if (n === null) {
            ctx.addIssue({ code: "custom", message: "Enter a whole number, for example 45" });
            return;
          }
          if (n < config.min_group_size) {
            ctx.addIssue({ code: "custom", message: `Group bookings are for ${config.min_group_size} or more people. For smaller groups, buy day tickets on Quicket.` });
          } else if (config.max_group_size && n > config.max_group_size) {
            ctx.addIssue({ code: "custom", message: `For more than ${config.max_group_size} people please phone us${phone}.` });
          }
        })
        .transform((value) => wholeNumber(value) ?? 0),
      arrival_time: z
        .string()
        .trim()
        .refine((value) => value === "" || config.arrival_slots.includes(value), "Choose an arrival time from the list"),
    })
    .superRefine((value, ctx) => {
      if (value.alternative_date && value.alternative_date === value.visit_date) {
        ctx.addIssue({ code: "custom", path: ["alternative_date"], message: "Choose a different day from your preferred date" });
      }
    });
}

export function groupSchema(config: FormConfig) {
  const codes = new Set(config.group_types.map((g) => g.code));
  const optionalCount = (label: string, max?: number, maxMessage?: string) =>
    z
      .string()
      .trim()
      .superRefine((value, ctx) => {
        if (!value) return;
        const n = wholeNumber(value);
        if (n === null) {
          ctx.addIssue({ code: "custom", message: label });
          return;
        }
        if (max !== undefined && n > max) ctx.addIssue({ code: "custom", message: maxMessage ?? label });
      })
      .transform((value) => (value ? (wholeNumber(value) ?? 0) : 0));

  return z.object({
    group_name: z.string().trim().min(1, "Enter the name of your group").max(255, "Keep the group name under 255 characters"),
    group_type: z.string().refine((value) => codes.has(value), "Choose the kind of group"),
    area: z.string().trim().max(255, "Keep the area under 255 characters"),
    vehicles: optionalCount("Enter a whole number of vehicles, for example 2"),
    gazebos: optionalCount("Enter a whole number of gazebos, for example 1", config.max_gazebos, `We have ${config.max_gazebos} gazebos to hire`),
    questions: z
      .array(z.string().trim().max(500, "Keep each question under 500 characters"))
      .transform((items) => items.filter((q) => q.length > 0))
      .refine((items) => items.length <= config.max_questions, `You can ask up to ${config.max_questions} questions`),
    customer_notes: z.string().trim().max(2000, "Keep this under 2 000 characters"),
  });
}

export function contactSchema() {
  return z.object({
    contact_name: z.string().trim().min(1, "Enter your name").max(255, "Keep your name under 255 characters"),
    contact_email: z
      .string()
      .trim()
      .min(1, "Enter your email address")
      .refine((value) => z.email().safeParse(value).success, "Enter an email address in the format name@example.com"),
    contact_mobile: z.string().trim().min(1, "Enter a mobile number").refine((value) => PHONE.test(value), "Enter a mobile number, for example 082 123 4567"),
  });
}

export type VisitInput = z.input<ReturnType<typeof visitSchema>>;
export type VisitOutput = z.output<ReturnType<typeof visitSchema>>;
export type GroupInput = z.input<ReturnType<typeof groupSchema>>;
export type GroupOutput = z.output<ReturnType<typeof groupSchema>>;
export type ContactInput = z.input<ReturnType<typeof contactSchema>>;
export type ContactOutput = z.output<ReturnType<typeof contactSchema>>;

/** The POST body from the three parsed screens (Turnstile and honeypot added by the Check screen). */
export function buildPayload(visit: VisitOutput, group: GroupOutput, contact: ContactOutput): Omit<BookingRequestInput, "website" | "turnstile_token"> {
  return {
    visit_date: visit.visit_date,
    alternative_date: visit.alternative_date || undefined,
    visitors: visit.visitors,
    arrival_time: visit.arrival_time || undefined,
    group_name: group.group_name,
    group_type: group.group_type,
    area: group.area || undefined,
    vehicles: group.vehicles,
    gazebos: group.gazebos,
    questions: group.questions,
    customer_notes: group.customer_notes || undefined,
    contact_name: contact.contact_name,
    contact_email: contact.contact_email,
    contact_mobile: contact.contact_mobile,
    policy_accepted: true,
  };
}

/** First message per field from a zod failure, keyed by the top-level field name. */
export function issuesByField(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}
