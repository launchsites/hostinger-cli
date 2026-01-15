import fs from "fs";
import path from "path";
import fg from "fast-glob";
import type SftpClient from "ssh2-sftp-client";
import { ensureRemoteDir, removeRemoteRecursive } from "../sftp/client";
import { normalizeRemotePath } from "../utils/path";

export interface SyncOptions {
  localDir: string;
  remoteDir: string;
  clean: boolean;
  dryRun: boolean;
  sftp: SftpClient;
}

export interface SyncResult {
  uploaded: string[];
  skipped: string[];
  deleted: string[];
}

const DEFAULT_IGNORES = ["**/.git/**", "**/.DS_Store", "**/node_modules/**"];

function toPosixRelative(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function shouldUpload(client: SftpClient, remotePath: string, localStat: fs.Stats): Promise<boolean> {
  try {
    const stat = await client.stat(remotePath);
    if (!stat) {
      return true;
    }

    if (stat.size !== localStat.size) {
      return true;
    }

    const remoteMtime = stat.modifyTime ? stat.modifyTime * 1000 : 0;
    if (remoteMtime && localStat.mtimeMs > remoteMtime + 2000) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

async function listRemoteRecursive(client: SftpClient, remoteDir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await client.list(remoteDir);
  for (const entry of entries) {
    const fullPath = `${remoteDir}/${entry.name}`;
    if (entry.type === "d") {
      results.push(...(await listRemoteRecursive(client, fullPath)));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

export async function syncDirectory(options: SyncOptions): Promise<SyncResult> {
  const { localDir, remoteDir, clean, dryRun, sftp } = options;
  const absoluteLocal = path.resolve(localDir);
  const normalizedRemoteDir = normalizeRemotePath(remoteDir);

  const files = await fg(["**/*"], {
    cwd: absoluteLocal,
    onlyFiles: true,
    dot: true,
    ignore: DEFAULT_IGNORES,
  });

  const uploaded: string[] = [];
  const skipped: string[] = [];
  const deleted: string[] = [];

  const remoteDirs = new Set<string>();

  for (const file of files) {
    const localPath = path.join(absoluteLocal, file);
    const relativePosix = toPosixRelative(file);
    const remotePath = `${normalizedRemoteDir}/${relativePosix}`;
    const remoteDirname = path.posix.dirname(remotePath);

    if (!remoteDirs.has(remoteDirname)) {
      if (!dryRun) {
        await ensureRemoteDir(sftp, remoteDirname);
      }
      remoteDirs.add(remoteDirname);
    }

    const stat = fs.statSync(localPath);
    const upload = await shouldUpload(sftp, remotePath, stat);

    if (upload) {
      if (!dryRun) {
        await sftp.put(localPath, remotePath);
      }
      uploaded.push(relativePosix);
    } else {
      skipped.push(relativePosix);
    }
  }

  if (clean) {
    const remoteFiles = await listRemoteRecursive(sftp, normalizedRemoteDir);
    const localSet = new Set(files.map((file) => `${normalizedRemoteDir}/${toPosixRelative(file)}`));

    for (const remoteFile of remoteFiles) {
      if (!localSet.has(remoteFile)) {
        if (!dryRun) {
          await removeRemoteRecursive(sftp, remoteFile);
        }
        deleted.push(remoteFile);
      }
    }
  }

  return { uploaded, skipped, deleted };
}
