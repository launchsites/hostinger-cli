export interface ProgressReporter {
  add(bytes: number): void;
  finish(): void;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export class TransferProgress implements ProgressReporter {
  private totalBytes: number;
  private transferredBytes = 0;
  private readonly label: string;
  private readonly startTime = Date.now();
  private lastRender = 0;
  private lastLineLength = 0;
  private readonly enabled = Boolean(process.stdout.isTTY);

  constructor(totalBytes: number, label: string) {
    this.totalBytes = Math.max(0, totalBytes);
    this.label = label;
    this.render(true);
  }

  add(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return;
    }
    this.transferredBytes += bytes;
    this.render(false);
  }

  finish(): void {
    this.render(true);
    if (this.enabled) {
      process.stdout.write("\n");
    }
  }

  private render(force: boolean): void {
    if (!this.enabled) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastRender < 100) {
      return;
    }
    this.lastRender = now;

    const elapsedSeconds = Math.max(0.001, (now - this.startTime) / 1000);
    const speed = this.transferredBytes / elapsedSeconds;
    const percent = this.totalBytes > 0 ? Math.min(this.transferredBytes / this.totalBytes, 1) : 1;

    const barWidth = 24;
    const filled = Math.round(percent * barWidth);
    const bar = `${"#".repeat(filled)}${"-".repeat(barWidth - filled)}`;

    const percentText = `${Math.round(percent * 100)}`.padStart(3, " ");
    let line = `${this.label} [${bar}] ${percentText}% ${formatBytes(this.transferredBytes)}/${formatBytes(
      this.totalBytes
    )} ${formatBytes(speed)}/s`;

    const columns = process.stdout.columns || 80;
    if (line.length > columns - 1) {
      line = line.slice(0, columns - 1);
    }

    const padded = line.padEnd(this.lastLineLength, " ");
    process.stdout.write(`\r${padded}`);
    this.lastLineLength = Math.max(this.lastLineLength, line.length);
  }
}
