/** Park identity used by the shell (public layout footer, login, titles). */

export const APP_NAME = "Farmyard Bookings";
export const PARK_NAME = "The Farmyard Park";
export const PARK_LEGAL_NAME = "The Farmyard Park (Pty) Ltd";

export const PARK_CONTACT = {
  phone: "081 461 4246",
  phoneHref: "tel:+27814614246",
  email: "thefarmyardpark@gmail.com",
  website: "www.farmyardpark.co.za",
  websiteHref: "https://www.farmyardpark.co.za",
  addressLine1: "Protea Road",
  addressLine2: "Klapmuts, 7625",
} as const;

export function pageTitle(title?: string): string {
  return title ? `${title} · ${APP_NAME}` : APP_NAME;
}
