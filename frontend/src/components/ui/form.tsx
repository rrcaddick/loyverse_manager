/**
 * Form primitives for react-hook-form, in the classic shadcn shape, styled
 * with the registry's `field` component so hand-written and generated forms
 * look identical.
 *
 *   <Form {...form}>
 *     <form onSubmit={form.handleSubmit(onSubmit)}>
 *       <FormField control={form.control} name="email" render={({ field }) => (
 *         <FormItem>
 *           <FormLabel>Email</FormLabel>
 *           <FormControl><Input type="email" {...field} /></FormControl>
 *           <FormDescription>We never share it.</FormDescription>
 *           <FormMessage />
 *         </FormItem>
 *       )} />
 *     </form>
 *   </Form>
 *
 * Most pages should reach for the typed helpers in @/components/form/fields
 * instead, which wrap these.
 */

import * as React from "react";
import { Slot } from "radix-ui";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

type FormItemContextValue = { id: string };

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

function FormItem({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" | "responsive" }) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <Field data-slot="form-item" orientation={orientation} className={cn(className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof FieldLabel>) {
  const { error, formItemId } = useFormField();
  return (
    <FieldLabel
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  return (
    <FieldDescription data-slot="form-description" id={formDescriptionId} className={className} {...props} />
  );
}

function FormMessage({ className, children, ...props }: React.ComponentProps<"div">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : children;
  if (!body) return null;
  return (
    <FieldError data-slot="form-message" id={formMessageId} className={className} {...props}>
      {body}
    </FieldError>
  );
}

export { useFormField, Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField };
