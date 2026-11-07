import { useState } from "react";
import { z } from "zod";

import { FieldRow, NumberField, TextField, TextareaField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { useUpdateSection } from "@/features/settings/api";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, pick, requiredText, runSave } from "./shared";

const prefix = z
  .string()
  .trim()
  .min(1, "Enter a prefix")
  .max(6, "Up to 6 characters")
  .regex(/^[A-Z0-9-]+$/, "Capital letters, digits and hyphens only");

const schema = z.object({
  documents: z.object({
    next_number: count("Enter the next number").min(1, "Start at 1 or higher"),
    proforma_prefix: prefix,
    invoice_prefix: prefix,
    company_name: requiredText("Enter the registered company name"),
    trading_name: requiredText("Enter the trading name"),
    address_line1: requiredText("Enter the first address line"),
    address_line2: z.string().trim(),
    company_reg: z.string().trim(),
    vat_no: z.string().trim(),
    bank_name: requiredText("Enter the bank"),
    bank_account_name: requiredText("Enter the account name"),
    bank_account_type: z.string().trim(),
    bank_account_number: requiredText("Enter the account number").regex(/^[\d ]+$/, "Digits only"),
    bank_branch_code: z.string().trim().regex(/^[\d ]*$/, "Digits only"),
    pop_email: z.string().trim().email("Enter a valid email address"),
    payment_terms: z.string().trim().max(600, "Keep the terms to a short paragraph"),
  }),
});

type FormValues = z.input<typeof schema>;

export default function DocumentsTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("documents");
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { documents: data.settings.documents } });
  const docs = form.watch("documents");

  async function onSubmit(values: z.output<typeof schema>) {
    const keys = dirtyKeys(values.documents, form.formState.dirtyFields.documents);
    setError(
      await runSave(async () => {
        if (keys.length) await save.mutateAsync(pick(values.documents, keys));
        form.reset(values as FormValues);
      }),
    );
  }

  const nextNumber = Number(docs.next_number) || 0;

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section
        title="Numbering"
        description="Every booking takes the next number when it is created. Its proforma and invoice share that number with different prefixes."
        footer={
          <p className="text-sm text-muted-foreground tabular">
            Next booking: proforma <span className="font-mono text-foreground">{docs.proforma_prefix}{nextNumber}</span>, invoice{" "}
            <span className="font-mono text-foreground">{docs.invoice_prefix}{nextNumber}</span>
          </p>
        }
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <NumberField control={form.control} name="documents.next_number" label="Next number" integer min={1} description="Only move this forward" />
          <TextField control={form.control} name="documents.proforma_prefix" label="Proforma prefix" mono maxLength={6} />
          <TextField control={form.control} name="documents.invoice_prefix" label="Invoice prefix" mono maxLength={6} />
        </div>
      </Section>

      <Section title="Company" description="Printed in the header and footer of every document and email.">
        <div className="flex flex-col gap-5">
          <FieldRow>
            <TextField control={form.control} name="documents.company_name" label="Registered name" />
            <TextField control={form.control} name="documents.trading_name" label="Trading name" />
          </FieldRow>
          <FieldRow>
            <TextField control={form.control} name="documents.address_line1" label="Address line 1" />
            <TextField control={form.control} name="documents.address_line2" label="Address line 2" />
          </FieldRow>
          <FieldRow>
            <TextField control={form.control} name="documents.company_reg" label="Company registration" mono />
            <TextField control={form.control} name="documents.vat_no" label="VAT number" mono />
          </FieldRow>
        </div>
      </Section>

      <Section title="Bank details" description="Shown on proformas and invoices for EFT deposits. Proof of payment goes to the address below.">
        <div className="flex flex-col gap-5">
          <FieldRow>
            <TextField control={form.control} name="documents.bank_name" label="Bank" />
            <TextField control={form.control} name="documents.bank_account_name" label="Account name" />
          </FieldRow>
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField control={form.control} name="documents.bank_account_type" label="Account type" />
            <TextField control={form.control} name="documents.bank_account_number" label="Account number" mono />
            <TextField control={form.control} name="documents.bank_branch_code" label="Branch code" mono />
          </div>
          <TextField control={form.control} name="documents.pop_email" label="Proof-of-payment email" type="email" description="Customers are asked to send their proof of payment here. Usually the bookings mailbox." />
        </div>
      </Section>

      <Section title="Payment terms" description="One short paragraph printed under the totals on every proforma and invoice.">
        <TextareaField control={form.control} name="documents.payment_terms" label="Terms" hideLabel rows={3} maxLength={600} />
      </Section>
    </SettingsForm>
  );
}
