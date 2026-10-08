/**
 * Route table (docs/booking-system.md §10). react-router v7 **data mode**
 * (createBrowserRouter) so routes can use `lazy`, `handle.crumb` for
 * breadcrumbs, `errorElement` and `useBlocker` for dirty forms.
 *
 * To add a page: create src/pages/<area>/<Name>Page.tsx with a default
 * export, then add a route below with `lazy: page(() => import(...))` and a
 * `handle: { crumb: "Title" }`. Admin-only pages go under the RequireRole
 * admin branch; manager-visible ones under the shared branch.
 */

import { createBrowserRouter, Navigate, Outlet } from "react-router";

import { RouteErrorPage } from "@/app/ErrorBoundary";
import { RedirectIfAuthenticated, RequireAuth, RequireRole } from "@/app/guards";
import { AppLayout } from "@/layouts/AppLayout";
import { PublicLayout } from "@/layouts/PublicLayout";

type PageModule = { default: React.ComponentType };

/** Lazy route helper: `lazy: page(() => import("@/pages/x/XPage"))`. */
function page(loader: () => Promise<PageModule>) {
  return async () => {
    const mod = await loader();
    return { Component: mod.default };
  };
}

export const router = createBrowserRouter([
  // ---- public: no session needed -----------------------------------------
  {
    path: "/request",
    element: <PublicLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: page(() => import("@/pages/public/RequestPage")) },
      { path: "sent", lazy: page(() => import("@/pages/public/RequestSentPage")) },
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
    handle: { crumb: "Home", crumbTo: "/" },
    children: [
      // Shared by admin and manager
      {
        element: <RequireRole roles={["admin", "manager"]} />,
        children: [
          {
            path: "calendar",
            handle: { crumb: "Calendar" },
            children: [
              { index: true, lazy: page(() => import("@/pages/calendar/CalendarPage")) },
            ],
          },
          {
            path: "day/:date",
            handle: { crumb: "Calendar", crumbTo: "/calendar" },
            children: [
              {
                index: true,
                lazy: page(() => import("@/pages/calendar/DayPage")),
                handle: { crumb: (_: unknown, params: Record<string, string | undefined>) => params.date ?? "Day" },
              },
            ],
          },
        ],
      },
      // Admin only
      {
        element: <RequireRole roles={["admin"]} />,
        children: [
          { index: true, lazy: page(() => import("@/pages/queue/QueuePage")), handle: { crumb: "Queue" } },
          {
            path: "bookings",
            handle: { crumb: "Bookings" },
            children: [
              { index: true, lazy: page(() => import("@/pages/bookings/BookingsPage")) },
              {
                path: ":id",
                lazy: page(() => import("@/pages/bookings/BookingDetailPage")),
                handle: { crumb: (_: unknown, params: Record<string, string | undefined>) => `Booking ${params.id ?? ""}`.trim() },
              },
            ],
          },
          {
            path: "inbox",
            handle: { crumb: "Inbox" },
            children: [
              { index: true, lazy: page(() => import("@/pages/inbox/InboxPage")) },
              { path: ":messageId", lazy: page(() => import("@/pages/inbox/InboxPage")) },
            ],
          },
          { path: "payments", lazy: page(() => import("@/pages/payments/PaymentsPage")), handle: { crumb: "Payments" } },
          {
            path: "settings",
            handle: { crumb: "Settings" },
            children: [
              { index: true, element: <Navigate to="/settings/season" replace /> },
              { path: ":tab", lazy: page(() => import("@/pages/settings/SettingsPage")) },
            ],
          },
          { path: "users", lazy: page(() => import("@/pages/users/UsersPage")), handle: { crumb: "Users" } },
          { path: "ops", lazy: page(() => import("@/pages/ops/OpsPage")), handle: { crumb: "Ops" } },
        ],
      },
      { path: "forbidden", lazy: page(() => import("@/pages/errors/ForbiddenPage")), handle: { crumb: "No access" } },
      { path: "*", lazy: page(() => import("@/pages/errors/NotFoundPage")), handle: { crumb: "Not found" } },
    ],
  },
]);
