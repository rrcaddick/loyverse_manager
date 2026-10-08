/**
 * Client-side mirror of src/services/public_form.validate_request so most
 * mistakes are caught before the request; the server stays authoritative and
 * its 422 field messages are mapped straight onto the same fields.
 */

import { z } from "zod";

import { WEEKDAYS, formatDate, formatWeekday } from "@/lib/format";

import type { FormConfig } from "./types";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^\+?[\d\s()-]{9,20}$/;

/** Python weekday (0 = Monday) of an ISO date. */
export function pyWeekday(iso: string): number {
  const d = new Date(`${iso}T12:00:00`);
  return (d.getDay() + 6) % 7;
}

function listWeekdays(days: number[]): string {
  const names = days.map((d) => `${WEEKDAYS[d]?.label ?? "?"}s`);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Why a day cannot be booked, in the customer's words; null when it can. */
export function dateProblem(iso: string, config: FormConfig): string | null {
  if (iso < config.min_date) return `The earliest date we can take is ${formatDate(config.min_date)}`;
  if (config.max_date && iso > config.max_date) return `The season ends on ${formatDate(config.max_date)}`;
  if (config.closed_weekdays.includes(pyWeekday(iso))) return `We are closed on ${listWeekdays(config.closed_weekdays)}`;
  if (config.closed_days.includes(iso)) return `The park is closed on ${formatDate(iso)}`;
  return null;
}

export function dayNote(iso: string, config: FormConfig): string {
  const parts = [formatWeekday(iso)];
  if (config.peak_days.includes(iso)) parts.push("peak day, peak rates apply");
  return parts.join(" · ");
}

const count = (label: string) => z.number({ error: label }).int(label).min(0, "Cannot be negative");

export function buildSchema(config: FormConfig) {
  const dateField = (required: boolean) =>
    z
      .string()
      .refine((v) => (required ? isoDate.test(v) : v === "" || isoDate.test(v)), required ? "Choose your preferred date" : "Choose a date")
      .superRefine((v, ctx) => {
        const problem = v ? dateProblem(v, config) : null;
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      });

  return z
    .object({
      group_name: z.string().trim().min(1, "Tell us the name of your group").max(255, "Keep it under 255 characters"),
      group_type: z.string().min(1, "Choose the kind of group"),
      area: z.string().trim().max(255, "Keep it under 255 characters"),
      contact_name: z.string().trim().min(1, "Enter your name").max(255, "Keep it under 255 characters"),
      contact_email: z.string().trim().min(1, "Enter your email address").email("Enter a valid email address"),
      contact_mobile: z.string().trim().min(1, "Enter a mobile number").regex(PHONE, "Enter a valid mobile number"),
      visit_date: dateField(true),
      alternative_date: dateField(false),
      arrival_time: z.string().trim().max(20, "Keep it short, for example 10:00"),
      vehicles: count("Enter the number of vehicles"),
      gazebos: count("Enter the number of gazebos"),
      adults: count("Enter the number of adults"),
      children: count("Enter the number of children"),
      questions: z.array(z.object({ text: z.string().trim().max(500, "Keep each question under 500 characters") })).max(config.max_questions, `Up to ${config.max_questions} questions`),
      customer_notes: z.string().trim().max(2000, "Keep notes under 2 000 characters"),
      policy_accepted: z.boolean().refine((v) => v, "Please accept the booking policy to continue"),
      /** Honeypot: must stay empty. */
      website: z.string().max(0),
    })
    .superRefine((v, ctx) => {
      if (v.adults + v.children < config.min_group_size) {
        ctx.addIssue({ code: "custom", path: ["adults"], message: `Group bookings are for ${config.min_group_size} or more people` });
      }
      if (v.alternative_date && v.alternative_date === v.visit_date) {
        ctx.addIssue({ code: "custom", path: ["alternative_date"], message: "Choose a different day from your preferred date" });
      }
    });
}

export type RequestSchema = ReturnType<typeof buildSchema>;
export type RequestFormValues = z.input<RequestSchema>;
export type RequestFormOutput = z.output<RequestSchema>;

export function emptyValues(): RequestFormValues {
  return {
    group_name: "",
    group_type: "",
    area: "",
    contact_name: "",
    contact_email: "",
    contact_mobile: "",
    visit_date: "",
    alternative_date: "",
    arrival_time: "",
    vehicles: 0,
    gazebos: 0,
    adults: Number.NaN,
    children: Number.NaN,
    questions: [],
    customer_notes: "",
    policy_accepted: false,
    website: "",
  };
}
