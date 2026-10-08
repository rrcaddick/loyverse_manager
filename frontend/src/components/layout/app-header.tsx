import { CircleHelp, Search } from "lucide-react";
import { Fragment, useRef, useState, type FormEvent } from "react";
import { Link, useMatches, useNavigate } from "react-router";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcut } from "@/hooks/use-keyboard";
import { useAuth } from "@/lib/auth";
import { useShell } from "@/layouts/shell-context";

/** Route `handle` shape read by the breadcrumb. */
export interface RouteHandle {
  crumb?: string | ((data: unknown, params: Record<string, string | undefined>) => string);
  /** Route path to link the crumb to (defaults to the match's pathname). */
  crumbTo?: string;
}

function useCrumbs() {
  const matches = useMatches();
  return matches
    .filter((match) => (match.handle as RouteHandle | undefined)?.crumb)
    .map((match) => {
      const handle = match.handle as RouteHandle;
      const label = typeof handle.crumb === "function" ? handle.crumb(match.data, match.params) : handle.crumb!;
      return { id: match.id, label, to: handle.crumbTo ?? match.pathname };
    });
}

/** 56 px header: sidebar toggle, breadcrumb, search (admin) and help. */
export function AppHeader() {
  const crumbs = useCrumbs();
  const { isAdmin } = useAuth();
  const { openHelp } = useShell();
  return (
    <header className="sticky top-0 z-20 flex h-header shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-6">
      <SidebarTrigger className="-ml-1.5 size-9" aria-label="Toggle navigation" />
      <Separator orientation="vertical" className="mr-1 h-5!" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap text-body">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <Fragment key={crumb.id}>
                {index > 0 ? <BreadcrumbSeparator className={index === 1 ? "hidden sm:block" : undefined} /> : null}
                <BreadcrumbItem className={index < crumbs.length - 1 && index === 0 ? "hidden sm:block" : "min-w-0"}>
                  {last ? (
                    <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.to} className="truncate">
                        {crumb.label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {isAdmin ? <GlobalSearch /> : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={openHelp}>
            <CircleHelp className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Keyboard shortcuts <Kbd>?</Kbd>
        </TooltipContent>
      </Tooltip>
    </header>
  );
}

/**
 * Global search box. Submits to /bookings?q=… (the bookings list filters on
 * `q`). "/" focuses it from anywhere outside an input.
 */
function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useShortcut("/", () => inputRef.current?.focus());

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const q = value.trim();
    navigate(q ? `/bookings?q=${encodeURIComponent(q)}` : "/bookings");
    inputRef.current?.blur();
  }

  return (
    <>
      <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Search bookings" onClick={() => navigate("/bookings")}>
        <Search className="size-5" />
      </Button>
      <form role="search" onSubmit={onSubmit} className="hidden w-72 sm:block">
        <InputGroup className="h-9 bg-card/60">
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Search bookings"
            aria-label="Search bookings by reference, group or contact"
            autoComplete="off"
            className="text-body"
          />
          <InputGroupAddon align="inline-end">
            <Kbd aria-hidden="true">/</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </>
  );
}
