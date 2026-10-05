export interface NavItem {
  path: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/season", label: "Season" },
  { path: "/owner", label: "Owners" },
  { path: "/players", label: "Players" },
  { path: "/analytics", label: "Analytics" },
  { path: "/superlatives", label: "Records" },
];
