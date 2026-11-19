/** Primary navigation, shared by the header and footer. */
export interface NavItem {
  href: string;
  label: string;
}

export const primaryNav: NavItem[] = [
  { href: "/", label: "Near me" },
  { href: "/species/", label: "Species" },
  { href: "/places/", label: "Places" },
  { href: "/calendar/", label: "Calendar" },
  { href: "/map/", label: "Map" },
  { href: "/watchlist/", label: "Watchlist" },
];

export const footerNav: NavItem[] = [
  { href: "/about/", label: "About & method" },
  { href: "/about/#sources", label: "Data sources" },
  { href: "/about/#ethics", label: "Birding ethics" },
];

/** True when `href` is the current page or a parent section of it. */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
