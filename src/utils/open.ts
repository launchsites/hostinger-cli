import { spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

export function openPath(targetPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = os.platform();
    let command: string;
    let args: string[];

    if (platform === "darwin") {
      command = "open";
      args = [targetPath];
    } else if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", targetPath];
    } else {
      command = "xdg-open";
      args = [targetPath];
    }

    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code && code !== 0) {
        reject(new Error(`Failed to open ${targetPath}`));
        return;
      }
      resolve();
    });
  });
}

export function createTempDir(prefix: string): string {
  const tempBase = path.join(os.tmpdir(), "hostinger-cli");
  fs.mkdirSync(tempBase, { recursive: true });
  return fs.mkdtempSync(path.join(tempBase, `${prefix}-`));
}
