import { useEffect } from "react";

import { pageTitle } from "@/lib/brand";

/** Sets document.title to "<title> · Farmyard Bookings" while mounted. */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = pageTitle(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}
