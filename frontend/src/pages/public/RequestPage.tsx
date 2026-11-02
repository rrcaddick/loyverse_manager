/**
 * /request → the first screen of the stepped form (query string kept).
 * With `?complete=<token>` the office saved this request already: the form
 * opens with what we have filled in and the answers complete it.
 */

import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";

import { PageSkeleton } from "@/components/page-skeleton";
import { api } from "@/lib/api";

import { clearDraft, saveCompleteToken, saveDraft, type Draft } from "@/features/public/draft";

interface Prefill {
  group_name: string;
  group_type: string;
  area: string;
  contact_name: string;
  contact_email: string;
  contact_mobile: string;
  visit_date: string;
  alternative_date: string;
  visitors: number | "";
  customer_notes: string;
  questions: string[];
}

export default function RequestPage() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  const complete = params.get("complete");
  const [ready, setReady] = useState(!complete);

  useEffect(() => {
    if (!complete) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await api.get<Prefill>("/public/booking-request/prefill", { params: { token: complete } });
        clearDraft();
        const patch: Partial<Draft> = {
          visit_date: p.visit_date ?? "",
          alternative_date: p.alternative_date ?? "",
          visitors: p.visitors ? String(p.visitors) : "",
          group_name: p.group_name ?? "",
          group_type: p.group_type ?? "",
          area: p.area ?? "",
          questions: p.questions.length ? p.questions : [""],
          customer_notes: p.customer_notes ?? "",
          contact_name: p.contact_name ?? "",
          contact_email: p.contact_email ?? "",
          contact_mobile: p.contact_mobile ?? "",
        };
        saveDraft(patch);
        saveCompleteToken(complete);
      } catch {
        // An old or used link: the form simply starts empty.
        saveCompleteToken(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [complete]);

  if (!ready) return <PageSkeleton />;
  params.delete("complete");
  const rest = params.toString();
  return <Navigate to={`/request/visit${rest ? `?${rest}` : ""}${hash}`} replace />;
}
