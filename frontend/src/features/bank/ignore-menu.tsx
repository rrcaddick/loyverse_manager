/**
 * Ignore ▾ — Own transfer, Card settlement, Interest (each: only this entry,
 * or this and similar in future → `create_rule`), and Other… (a note).
 * No dialog for the first three; "Other…" asks for the reason in a small
 * dialog because the server requires one.
 */

import { ChevronDown, EyeOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";

import { deriveRulePattern } from "./lib";
import type { MatchFlow } from "./match-flow";
import { IGNORE_REASON_LABELS, RULE_REASONS, type BankTransaction } from "./types";

interface IgnoreMenuProps {
  tx: BankTransaction;
  flow: MatchFlow;
  size?: "sm" | "xs";
  variant?: "ghost" | "outline";
  align?: "start" | "end";
}

export function IgnoreMenu({ tx, flow, size = "sm", variant = "ghost", align = "end" }: IgnoreMenuProps) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pattern = deriveRulePattern(tx.description);

  async function ignoreOther() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await flow.ignore(tx, { reason: "other", note: note.trim() });
      setOtherOpen(false);
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} disabled={flow.busy} aria-label="Ignore this entry">
            <EyeOff data-icon="inline-start" />
            Ignore
            <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-60">
          <DropdownMenuLabel>Not a booking payment because it is…</DropdownMenuLabel>
          {RULE_REASONS.map((reason) => (
            <DropdownMenuSub key={reason}>
              <DropdownMenuSubTrigger>{IGNORE_REASON_LABELS[reason]}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72">
                <DropdownMenuItem onSelect={() => void flow.ignore(tx, { reason })}>Only this entry</DropdownMenuItem>
                <DropdownMenuItem disabled={pattern.length < 4} onSelect={() => void flow.ignore(tx, { reason, create_rule: true })}>
                  <span className="flex flex-col">
                    <span>This and similar in future</span>
                    <span className="text-xs text-muted-foreground">
                      Entries starting “<span className="font-mono">{pattern || tx.description.slice(0, 20)}</span>”
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOtherOpen(true)}>{IGNORE_REASON_LABELS.other}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={otherOpen} onOpenChange={(open) => !busy && setOtherOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ignore this entry?</DialogTitle>
            <DialogDescription>
              {formatMoney(tx.amount, { compact: true })} · “{tx.description}”. It leaves Needs attention and is never suggested again; you can restore it from its drawer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ignore-note">Why</Label>
            <Textarea id="ignore-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={200} placeholder="e.g. refund of a Quicket ticket" className="min-h-0 resize-none" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOtherOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void ignoreOther()} disabled={!note.trim() || busy}>
              {busy ? <Spinner data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
              Ignore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
