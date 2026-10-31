/**
 * /enquiries and /enquiries/:id — triage of the conversations that matched no
 * booking (agreed 26 Oct 2026, docs/handoff/ui-round2-plan.md §6): the list
 * on the left in the Bookings row style, the selected conversation in a
 * reading pane on the right with the decisions across its top. Nothing
 * navigates away; after Resolve, Not an enquiry, Attach or Create request the
 * selection steps to the next open row. Below 64 rem the same route shows
 * the list alone and opens an enquiry full width with a way back.
 *
 * State lives in the URL: the bucket (?tab), the search (?q) and the page.
 */

import { ChevronLeft, ChevronRight, Inbox, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useEnquiries, useEnquiry } from "@/features/enquiries/api";
import { EnquiryList } from "@/features/enquiries/components/enquiry-list";
import { EnquiryPane } from "@/features/enquiries/components/enquiry-pane";
import { BUCKET_LABELS, ENQUIRY_BUCKETS, type Enquiry, type EnquiryBucket, type EnquiryCounts } from "@/features/enquiries/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const EMPTY_COPY: Record<EnquiryBucket, { title: string; hint: string }> = {
  open: { title: "Nothing waiting on you", hint: "Mail that matches no booking and gets no answer becomes an enquiry here." },
  resolved: { title: "Nothing resolved yet", hint: "An enquiry you have dealt with without a booking is kept here." },
  not_booking: { title: "Nothing marked as not an enquiry", hint: "Conversations that were never about a visit are kept here." },
  all: { title: "No enquiries yet", hint: "Mail that matches no booking and gets no answer becomes an enquiry here." },
};

function bucketOf(raw: string | null): EnquiryBucket {
  return (ENQUIRY_BUCKETS as string[]).includes(raw ?? "") ? (raw as EnquiryBucket) : "open";
}

function bucketCount(counts: EnquiryCounts | undefined, bucket: EnquiryBucket): number {
  if (!counts) return 0;
  switch (bucket) {
    case "open":
      return counts.waiting;
    case "resolved":
      return counts.resolved;
    case "not_booking":
      return counts.not_booking;
    default:
      return counts.open + counts.replied + counts.converted + counts.attached + counts.resolved + counts.not_booking;
  }
}

export default function EnquiriesPage() {
  useDocumentTitle("Enquiries");
  const navigate = useNavigate();
  const { id } = useParams();
  const selectedId = id && /^\d+$/.test(id) ? Number(id) : null;
  const [params] = useSearchParams();
  const { appearance } = useAppearance();
  const tab = bucketOf(params.get("tab"));
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const size = appearance.table_rows;
  const list = useEnquiries({ status: tab, q, page, page_size: size });
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const counts = list.data?.counts;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const selected = useMemo(() => items.find((e) => e.id === selectedId) ?? null, [items, selectedId]);

  const search = params.toString();
  const hrefFor = (e: Enquiry) => `/enquiries/${e.id}${search ? `?${search}` : ""}`;
  function update(patch: Record<string, string | number | null>, keepSelection = true) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || (k === "page" && v === 1) || (k === "tab" && v === "open")) next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    navigate(`${keepSelection && selectedId ? `/enquiries/${selectedId}` : "/enquiries"}${qs ? `?${qs}` : ""}`, { replace: true });
  }

  /** The enquiry is dealt with: move to the next open one on this page, else back to the list. */
  function onDone(e: Enquiry) {
    const index = items.findIndex((x) => x.id === e.id);
    const next = tab === "open" ? (items.slice(index + 1).find((x) => x.waiting) ?? items.slice(0, index).find((x) => x.waiting)) : undefined;
    navigate(next ? hrefFor(next) : `/enquiries${search ? `?${search}` : ""}`, { replace: true });
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Enquiries</h1>
        <SegmentedTabs
          aria-label="Enquiry buckets"
          value={tab}
          onChange={(next) => update({ tab: next, page: 1 }, false)}
          items={ENQUIRY_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b], count: b === "open" ? bucketCount(counts, b) : 0 }))}
        />
      </header>

      {list.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load enquiries</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{errorMessage(list.error)}</span>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* The list column. Below lg it is the whole page unless an enquiry is open. */}
        <section
          aria-label={`${BUCKET_LABELS[tab]} enquiries`}
          className={cn(
            "flex min-h-0 w-full flex-col gap-2 lg:w-[26rem] lg:shrink-0 xl:w-[30rem]",
            selectedId !== null && "max-lg:hidden",
          )}
        >
          <Toolbar q={q} onSearch={(value) => update({ q: value, page: 1 })} total={list.data ? total : null} page={page} pageCount={pageCount} size={size} onPage={(p) => update({ page: p })} />
          <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl bg-card shadow-sm ring-1 ring-border transition-opacity scrollbar-thin", list.isPlaceholderData && "opacity-80")}>
            {list.isPending ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <EmptyState
                variant="card"
                icon={Inbox}
                title={q ? "No enquiries match" : EMPTY_COPY[tab].title}
                hint={q ? "Try another name, address or subject." : EMPTY_COPY[tab].hint}
                action={q ? <Button variant="outline" onClick={() => update({ q: null, page: 1 })}>Clear search</Button> : undefined}
                link={tab !== "all" && !q ? { to: "/enquiries?tab=all", label: "All enquiries" } : undefined}
              />
            ) : (
              <EnquiryList items={items} selectedId={selectedId} hrefFor={hrefFor} />
            )}
          </div>
        </section>

        {/* The reading pane. Below lg it is the whole page when an enquiry is open. */}
        <section className={cn("min-h-0 flex-1 flex-col rounded-xl bg-card p-4 shadow-sm ring-1 ring-border", selectedId === null ? "max-lg:hidden lg:flex" : "flex")}>
          {selectedId === null ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState variant="inline" icon={Inbox} title="Pick an enquiry" hint="The conversation opens here, with Reply at the bottom and the decisions at the top." />
            </div>
          ) : selected ? (
            <EnquiryPane key={selected.id} enquiry={selected} onDone={onDone} backTo={`/enquiries${search ? `?${search}` : ""}`} className="lg:[&>header>div>a]:hidden" />
          ) : list.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <StandaloneEnquiry id={selectedId} onDone={onDone} backTo={`/enquiries${search ? `?${search}` : ""}`} />
          )}
        </section>
      </div>
    </>
  );
}

/** An enquiry opened by id that is not on the current page of the list (a link from Work). */
function StandaloneEnquiry({ id, onDone, backTo }: { id: number; onDone: (e: Enquiry) => void; backTo: string }) {
  const detail = useEnquiry(id);
  if (detail.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (detail.isError || !detail.data) return <EmptyState variant="inline" icon={Inbox} title="There is no enquiry with this id" hint="It may have been removed, or the link is wrong." link={{ to: "/enquiries", label: "Back to enquiries" }} />;
  return <EnquiryPane key={id} enquiry={detail.data.enquiry} onDone={onDone} backTo={backTo} className="lg:[&>header>div>a]:hidden" />;
}

// ------------------------------------------------------------------ toolbar

function Toolbar({ q, onSearch, total, page, pageCount, size, onPage }: { q: string; onSearch: (q: string) => void; total: number | null; page: number; pageCount: number; size: number; onPage: (page: number) => void }) {
  const [value, setValue] = useState(q);
  const [synced, setSynced] = useState(q);
  if (q !== synced) {
    setSynced(q);
    setValue(q);
  }
  useEffect(() => {
    if (value.trim() === q) return;
    const timer = window.setTimeout(() => onSearch(value.trim()), 350);
    return () => window.clearTimeout(timer);
    // The debounce only cares about the typed value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const from = !total ? 0 : (page - 1) * size + 1;
  const to = total === null ? 0 : Math.min(total, page * size);
  return (
    <div className="flex items-center gap-2">
      <form
        role="search"
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(value.trim());
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput data-list-search type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Name, address or subject" aria-label="Search enquiries" autoComplete="off" />
          {value ? (
            <InputGroupAddon align="inline-end">
              <button type="button" aria-label="Clear search" onClick={() => setValue("")} className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection-ring">
                <X className="size-3.5" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </form>
      <div className="flex shrink-0 items-center gap-0.5">
        {total !== null ? (
          <span className="mr-0.5 text-sm tabular text-muted-foreground" aria-live="polite">
            {total === 0 ? "None" : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
          </span>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
