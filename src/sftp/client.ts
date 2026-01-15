import fs from "fs";
import path from "path";
import SftpClient from "ssh2-sftp-client";
import type { SftpConfig } from "../config";
import type { ProgressReporter } from "../utils/progress";

export interface ConnectedSftp {
  client: SftpClient;
  close: () => Promise<void>;
}

export async function connectSftp(config: SftpConfig): Promise<ConnectedSftp> {
  const client = new SftpClient();

  const baseOptions: Record<string, unknown> = {
    host: config.host,
    port: config.port,
    username: config.username,
  };

  if (config.auth.type === "password") {
    baseOptions.password = config.auth.password;
  } else {
    const keyPath = path.resolve(config.auth.privateKeyPath);
    baseOptions.privateKey = fs.readFileSync(keyPath, "utf8");
    if (config.auth.passphrase) {
      baseOptions.passphrase = config.auth.passphrase;
    }
  }

  await client.connect(baseOptions);

  return {
    client,
    close: async () => {
      await client.end();
    },
  };
}

export async function putWithProgress(
  client: SftpClient,
  localPath: string,
  remotePath: string,
  progress?: ProgressReporter
): Promise<void> {
  if (!progress) {
    await client.put(localPath, remotePath);
    return;
  }

  const readStream = fs.createReadStream(localPath);
  readStream.on("data", (chunk) => {
    progress.add(chunk.length);
  });
  await client.put(readStream, remotePath);
}

export async function ensureRemoteDir(client: SftpClient, remoteDir: string): Promise<void> {
  if (await client.exists(remoteDir)) {
    return;
  }
  await client.mkdir(remoteDir, true);
}

export async function removeRemoteRecursive(client: SftpClient, remotePath: string): Promise<void> {
  const type = await client.exists(remotePath);
  if (!type) {
    return;
  }
  if (type === "d") {
    const entries = await client.list(remotePath);
    for (const entry of entries) {
      const child = `${remotePath}/${entry.name}`;
      if (entry.type === "d") {
        await removeRemoteRecursive(client, child);
      } else {
        await client.delete(child);
      }
    }
    await client.rmdir(remotePath, true);
  } else {
    await client.delete(remotePath);
  }
}

export async function clearRemoteDir(client: SftpClient, remoteDir: string): Promise<void> {
  const type = await client.exists(remoteDir);
  if (!type) {
    return;
  }
  if (type !== "d") {
    throw new Error(`Remote path is not a directory: ${remoteDir}`);
  }
  const entries = await client.list(remoteDir);
  for (const entry of entries) {
    const child = `${remoteDir}/${entry.name}`;
    if (entry.type === "d") {
      await removeRemoteRecursive(client, child);
    } else {
      await client.delete(child);
    }
  }
}
