/**
 * Route table (docs/redesign-spec.md §1). react-router v7 **data mode**
 * (createBrowserRouter) so routes can use `lazy`, `handle.crumb` for
 * breadcrumbs, `errorElement` and `useBlocker` for dirty forms.
 *
 *   /today, /today/:date      Today (the day view; manager's home)
 *   /work                     Work queue
 *   /calendar                 Season calendar (sidebar auto-collapses)
 *   /bookings, /bookings/:id  Bookings list and record
 *   /mail, /mail/:thrid       Mail queues and conversation
 *   /bank                     Bank feed
 *   /gate                     Gate: arrivals, open tickets, morning sync
 *   /settings/:section        Settings rail (managers: appearance, password)
 *   /users, /system           Admin
 *   /request/*                Public booking request (no session)
 *   /login, /change-password  Auth
 *
 * Redirects (old routes keep working): / → /today, /day/:date →
 * /today/:date, /inbox[/:id] → /mail, /payments → /bank, /ops → /system,
 * /queue → /work. Query strings are carried across.
 *
 * To add a page: create src/pages/<area>/<Name>Page.tsx with a default
 * export, add a route below with `lazy: page(() => import(...))` and a
 * `handle: { crumb: "Title" }`. Admin-only pages go under the RequireRole
 * admin branch; manager-visible ones under the shared branch (and their
 * path pattern into MANAGER_PATHS in src/lib/nav.ts).
 */

import { createBrowserRouter, Outlet } from "react-router";

import { RouteErrorPage } from "@/app/ErrorBoundary";
import { RedirectIfAuthenticated, RequireAuth, RequireRole } from "@/app/guards";
import { RedirectTo, SettingsIndexRedirect } from "@/app/redirects";
import { AppLayout } from "@/layouts/AppLayout";
import { PublicLayout } from "@/layouts/PublicLayout";
import { formatDateLong } from "@/lib/format";

type PageModule = { default: React.ComponentType };
type Params = Record<string, string | undefined>;

/** Lazy route helper: `lazy: page(() => import("@/pages/x/XPage"))`. */
function page(loader: () => Promise<PageModule>) {
  return async () => {
    const mod = await loader();
    return { Component: mod.default };
  };
}

const dateCrumb = (_: unknown, params: Params) => (params.date ? formatDateLong(params.date) : "Today");

export const router = createBrowserRouter([
  // ---- public: no session needed -----------------------------------------
  {
    path: "/request",
    element: <PublicLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: page(() => import("@/pages/public/RequestPage")) },
      { path: "visit", lazy: page(() => import("@/pages/public/RequestVisitPage")) },
      { path: "group", lazy: page(() => import("@/pages/public/RequestGroupPage")) },
      { path: "contact", lazy: page(() => import("@/pages/public/RequestContactPage")) },
      { path: "check", lazy: page(() => import("@/pages/public/RequestCheckPage")) },
      { path: "sent", lazy: page(() => import("@/pages/public/RequestSentPage")) },
      { path: "sent/:id", lazy: page(() => import("@/pages/public/RequestSentPage")) },
    ],
  },

  // ---- auth --------------------------------------------------------------
  {
    path: "/login",
    errorElement: <RouteErrorPage />,
    lazy: async () => {
      const mod = await import("@/pages/auth/LoginPage");
      const LoginPage = mod.default;
      return {
        Component: () => (
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        ),
      };
    },
  },
  {
    path: "/change-password",
    errorElement: <RouteErrorPage />,
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    children: [{ index: true, lazy: page(() => import("@/pages/auth/ChangePasswordPage")) }],
  },

  // ---- app shell ---------------------------------------------------------
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      // Shared by admin and manager
      {
        element: <RequireRole roles={["admin", "manager"]} />,
        children: [
          { index: true, element: <RedirectTo to="/today" /> },
          {
            path: "today",
            handle: { crumb: "Today", crumbTo: "/today" },
            children: [
              { index: true, lazy: page(() => import("@/pages/today/TodayPage")) },
              { path: ":date", lazy: page(() => import("@/pages/today/TodayPage")), handle: { crumb: dateCrumb } },
            ],
          },
          { path: "day/:date", element: <RedirectTo to={(p) => `/today/${p.date ?? ""}`} /> },
          { path: "calendar", lazy: page(() => import("@/pages/calendar/CalendarPage")), handle: { crumb: "Calendar" } },
          { path: "gate", lazy: page(() => import("@/pages/gate/GatePage")), handle: { crumb: "Gate" } },
          {
            path: "settings",
            handle: { crumb: "Settings", crumbTo: "/settings" },
            children: [
              { index: true, element: <SettingsIndexRedirect /> },
              { path: ":section", lazy: page(() => import("@/pages/settings/SettingsPage")) },
            ],
          },
        ],
      },
      // Admin only
      {
        element: <RequireRole roles={["admin"]} />,
        children: [
          { path: "work", lazy: page(() => import("@/pages/work/WorkPage")), handle: { crumb: "Work" } },
          { path: "queue", element: <RedirectTo to="/work" /> },
          {
            path: "bookings",
            handle: { crumb: "Bookings", crumbTo: "/bookings" },
            children: [
              { index: true, lazy: page(() => import("@/pages/bookings/BookingsPage")) },
              {
                path: ":id",
                lazy: page(() => import("@/pages/bookings/BookingDetailPage")),
                handle: { crumb: (_: unknown, params: Params) => `Booking ${params.id ?? ""}`.trim() },
              },
            ],
          },
          {
            path: "mail",
            handle: { crumb: "Mail", crumbTo: "/mail" },
            children: [
              { index: true, lazy: page(() => import("@/pages/mail/MailPage")) },
              { path: ":thrid", lazy: page(() => import("@/pages/mail/MailPage")) },
            ],
          },
          { path: "inbox", element: <RedirectTo to="/mail" /> },
          { path: "inbox/:messageId", element: <RedirectTo to="/mail" /> },
          { path: "bank", lazy: page(() => import("@/pages/bank/BankPage")), handle: { crumb: "Bank" } },
          { path: "payments", element: <RedirectTo to="/bank" /> },
          { path: "users", lazy: page(() => import("@/pages/users/UsersPage")), handle: { crumb: "Users" } },
          { path: "system", lazy: page(() => import("@/pages/system/SystemPage")), handle: { crumb: "System" } },
          { path: "ops", element: <RedirectTo to="/system" /> },
        ],
      },
      { path: "forbidden", lazy: page(() => import("@/pages/errors/ForbiddenPage")), handle: { crumb: "No access" } },
      { path: "*", lazy: page(() => import("@/pages/errors/NotFoundPage")), handle: { crumb: "Not found" } },
    ],
  },
]);
