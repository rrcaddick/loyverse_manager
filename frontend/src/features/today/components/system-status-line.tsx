/**
 * The one-line system status under Up next (spec §3):
 * "Mail 20:11 ✓ · Bank 20:10 ✓ · Loyverse sync off ●", linking to System.
 * A tick is green, a problem is a red dot with a word, "off" is grey.
 */

import { Check, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { SystemStatus } from "../types";

type Mark = "ok" | "bad" | "off";

function Dot({ mark }: { mark: Mark }) {
  if (mark === "ok") return <Check aria-hidden="true" className="size-3.5 text-green-solid" />;
  return <span aria-hidden="true" className={cn("inline-block size-2 rounded-full", mark === "bad" ? "bg-red-solid" : "bg-grey-solid")} />;
}

function Item({ label, value, mark, srText }: { label: string; value: string; mark: Mark; srText: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-foreground">{label}</span>
      <span className="tabular">{value}</span>
      <Dot mark={mark} />
      <span className="sr-only">{srText}</span>
    </span>
  );
}

export function SystemStatusLine({ system, className }: { system: SystemStatus; className?: string }) {
  const sync = system.loyverse_sync;
  const syncMark: Mark = sync.status === "ok" ? "ok" : sync.status === "failed" ? "bad" : "off";
  const syncValue =
    sync.status === "off" ? "off" : sync.status === "running" ? "running" : sync.status === "failed" ? "failed" : sync.last_run ? formatTime(sync.last_run.at) : "not run";
  return (
    <Link
      to="/system"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-1 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection-ring",
        className,
      )}
      aria-label="System status; open System"
    >
      <Item label="Mail" value={system.mail.last_synced_at ? formatTime(system.mail.last_synced_at) : "never"} mark={system.mail.ok ? "ok" : "bad"} srText={system.mail.ok ? "synced" : "problem"} />
      <Item label="Bank" value={system.bank.last_poll_at ? formatTime(system.bank.last_poll_at) : "never"} mark={system.bank.ok ? "ok" : "bad"} srText={system.bank.ok ? "polled" : "problem"} />
      <Item label="Loyverse sync" value={syncValue} mark={syncMark} srText={sync.status} />
      <ChevronRight aria-hidden="true" className="size-4 text-faint-foreground" />
    </Link>
  );
}
