import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, MoreHorizontal, Pencil, UserMinus, UserPlus, UserRoundCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormError, RadioField, SwitchField, TextField, applyApiErrors, useZodForm } from "@/components/form";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { useCreateUser, useResetPassword, useUpdateUser, useUsers } from "@/features/users/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { roleLabel, useAuth } from "@/lib/auth";
import { formatDateTime, formatRelativeDay, initials } from "@/lib/format";
import type { Role, User } from "@/types/api";

const ROLE_OPTIONS = [
  { value: "admin", label: "Administrator", description: "Everything: queue, bookings, inbox, payments, settings and users." },
  { value: "manager", label: "Manager", description: "Calendar and day view only: arrivals and gate payments." },
];

export default function UsersPage() {
  useDocumentTitle("Users");
  const { user: me } = useAuth();
  const usersQuery = useUsers();
  const [createOpen, setCreateOpen] = useState(false);
  const editing = useSubjectDialog<User>();
  const resetting = useSubjectDialog<User>();
  const toggling = useSubjectDialog<User>();
  const revealed = useSubjectDialog<{ user: User; password: string; reason: "created" | "reset" }>();

  const updateUser = useUpdateUser();
  const resetPassword = useResetPassword();

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                {initials(row.original.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="grid leading-tight">
              <span className="font-medium text-foreground">
                {row.original.full_name}
                {row.original.id === me?.id ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">{row.original.email}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.role} label={roleLabel(row.original.role)} tone={row.original.role === "admin" ? "blue" : "neutral"} dot={false} />
        ),
      },
      {
        id: "status",
        accessorFn: (u) => (u.is_active ? (u.must_change_password ? "invited" : "active") : "inactive"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
          const u = row.original;
          if (!u.is_active) return <StatusBadge status="inactive" label="Deactivated" tone="red-muted" />;
          if (u.must_change_password) return <StatusBadge status="invited" label="Temporary password" tone="amber" />;
          return <StatusBadge status="active" label="Active" tone="green" />;
        },
      },
      {
        accessorKey: "last_login_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last sign-in" />,
        cell: ({ row }) =>
          row.original.last_login_at ? (
            <span title={formatDateTime(row.original.last_login_at)} className="text-muted-foreground">
              {formatRelativeDay(row.original.last_login_at)}
            </span>
          ) : (
            <span className="text-muted-foreground">Never</span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { align: "right", className: "w-12" },
        cell: ({ row }) => {
          const u = row.original;
          const isMe = u.id === me?.id;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.full_name}`} onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => editing.show(u)}>
                  <Pencil aria-hidden="true" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => resetting.show(u)}>
                  <KeyRound aria-hidden="true" /> Reset password
                </DropdownMenuItem>
                {!isMe ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant={u.is_active ? "destructive" : "default"} onSelect={() => toggling.show(u)}>
                      {u.is_active ? <UserMinus aria-hidden="true" /> : <UserRoundCheck aria-hidden="true" />}
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [me?.id, editing, resetting, toggling],
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, and what they can see. New accounts get a temporary password that must be changed on first sign-in."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus data-icon="inline-start" />
            Add user
          </Button>
        }
      />
      <Section flush>
        <DataTable
          columns={columns}
          data={usersQuery.data ?? []}
          isLoading={usersQuery.isPending}
          getRowId={(u) => String(u.id)}
          onRowClick={(u) => editing.show(u)}
          pagination={false}
          emptyState={
            <EmptyState
              compact
              icon={UserPlus}
              title="No users yet"
              description="Add the first administrator to get started."
              action={<Button onClick={() => setCreateOpen(true)}>Add user</Button>}
            />
          }
        />
      </Section>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(user, password) => {
          setCreateOpen(false);
          revealed.show({ user, password, reason: "created" });
        }}
      />
      <EditUserDialog user={editing.subject} open={editing.open} onOpenChange={editing.onOpenChange} isSelf={editing.subject?.id === me?.id} />

      <ConfirmDialog
        open={resetting.open}
        onOpenChange={resetting.onOpenChange}
        title={`Reset password for ${resetting.subject?.full_name ?? ""}?`}
        description="Their current password stops working immediately. You will be shown a temporary password to pass on; they must change it at their next sign-in."
        confirmLabel="Reset password"
        onConfirm={async () => {
          const user = resetting.subject;
          if (!user) return;
          const result = await resetPassword.mutateAsync(user.id);
          resetting.close();
          revealed.show({ user, password: result.temporary_password, reason: "reset" });
        }}
      />

      <ConfirmDialog
        open={toggling.open}
        onOpenChange={toggling.onOpenChange}
        title={toggling.subject?.is_active ? `Deactivate ${toggling.subject.full_name}?` : `Reactivate ${toggling.subject?.full_name ?? ""}?`}
        description={
          toggling.subject?.is_active
            ? "They will be signed out and unable to sign in until reactivated. Nothing they recorded is removed."
            : "They will be able to sign in again with their existing password."
        }
        confirmLabel={toggling.subject?.is_active ? "Deactivate" : "Reactivate"}
        destructive={!!toggling.subject?.is_active}
        onConfirm={async () => {
          const user = toggling.subject;
          if (!user) return;
          const next = !user.is_active;
          await updateUser.mutateAsync({ id: user.id, is_active: next });
          toast.success(next ? `${user.full_name} reactivated` : `${user.full_name} deactivated`);
          toggling.close();
        }}
      />

      <TemporaryPasswordDialog revealed={revealed.subject} open={revealed.open} onClose={revealed.close} />
    </>
  );
}

// ------------------------------------------------------------- create user

const createSchema = z.object({
  full_name: z.string().trim().min(2, "Enter their full name"),
  email: z.string().trim().min(1, "Enter an email address").email("Enter a valid email address"),
  role: z.enum(["admin", "manager"], { error: "Choose a role" }),
});

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: User, temporaryPassword: string) => void;
}) {
  const create = useCreateUser();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema: createSchema, defaultValues: { full_name: "", email: "", role: "manager" } });

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
      setError(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(values: z.output<typeof createSchema>) {
    setError(null);
    try {
      const result = await create.mutateAsync({ ...values, role: values.role as Role });
      form.reset();
      onCreated(result.user, result.temporary_password);
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>They will receive a temporary password to change on first sign-in.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
            <FormError message={error} />
            <TextField control={form.control} name="full_name" label="Full name" autoComplete="off" autoFocus placeholder="Linda Caddick" />
            <TextField control={form.control} name="email" label="Email" type="email" autoComplete="off" placeholder="name@farmyardpark.co.za" />
            <RadioField control={form.control} name="role" label="Role" options={ROLE_OPTIONS} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Spinner data-icon="inline-start" /> : null}
                Create user
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------- edit user

const editSchema = z.object({
  full_name: z.string().trim().min(2, "Enter their full name"),
  role: z.enum(["admin", "manager"]),
  is_active: z.boolean(),
});

function EditUserDialog({ user, open, onOpenChange, isSelf }: { user: User | null; open: boolean; onOpenChange: (open: boolean) => void; isSelf: boolean }) {
  // Remount the form per user so defaultValues apply cleanly.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user ? <EditUserForm key={user.id} user={user} isSelf={isSelf} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditUserForm({ user, isSelf, onDone }: { user: User; isSelf: boolean; onDone: () => void }) {
  const update = useUpdateUser();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({
    schema: editSchema,
    defaultValues: { full_name: user.full_name, role: user.role, is_active: user.is_active },
  });

  async function onSubmit(values: z.output<typeof editSchema>) {
    setError(null);
    const changes: { full_name?: string; role?: Role; is_active?: boolean } = {};
    if (values.full_name !== user.full_name) changes.full_name = values.full_name;
    if (values.role !== user.role) changes.role = values.role as Role;
    if (values.is_active !== user.is_active) changes.is_active = values.is_active;
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    try {
      await update.mutateAsync({ id: user.id, ...changes });
      toast.success("User updated");
      onDone();
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {user.full_name}</DialogTitle>
        <DialogDescription>{user.email}</DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
          <FormError message={error} />
          <TextField control={form.control} name="full_name" label="Full name" autoComplete="off" />
          <RadioField
            control={form.control}
            name="role"
            label="Role"
            options={ROLE_OPTIONS}
            disabled={isSelf}
            description={isSelf ? "You cannot change your own role." : undefined}
          />
          <SwitchField
            control={form.control}
            name="is_active"
            label="Active"
            description={isSelf ? "You cannot deactivate yourself." : "Deactivated users cannot sign in."}
            disabled={isSelf}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
              {form.formState.isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}

// ------------------------------------------------------- temporary password

function TemporaryPasswordDialog({
  revealed,
  open,
  onClose,
}: {
  revealed: { user: User; password: string; reason: "created" | "reset" } | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={(e) => e.preventDefault()}>
        {revealed ? (
          <>
            <DialogHeader>
              <DialogTitle>{revealed.reason === "created" ? "User created" : "Password reset"}</DialogTitle>
              <DialogDescription>
                Pass this temporary password to {revealed.user.full_name} ({revealed.user.email}) through a channel you trust.
                It is shown once and cannot be retrieved later. They must choose a new password at their next sign-in.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-base tracking-wide select-all" aria-label="Temporary password">
                {revealed.password}
              </code>
              <CopyButton value={revealed.password} label="Copy" />
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
