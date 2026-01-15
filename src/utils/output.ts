import type { Website } from "../api/hosting";

export function printWebsites(websites: Website[]): void {
  if (websites.length === 0) {
    console.log("No websites found.");
    return;
  }

  const rows = websites.map((site, index) => {
    const status = site.is_enabled === false ? "disabled" : "enabled";
    return [String(index + 1), site.domain, site.username || "-", String(site.order_id || "-"), status];
  });

  const header = ["#", "Domain", "Username", "Order", "Status"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

  const formatRow = (row: string[]): string =>
    row.map((cell, i) => cell.padEnd(widths[i])).join("  ");

  console.log(formatRow(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

export function printKeyValue(values: Record<string, string | undefined>): void {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  for (const [key, value] of entries) {
    console.log(`${key}: ${value}`);
  }
}
