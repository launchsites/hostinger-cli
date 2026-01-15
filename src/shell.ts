import fs from "fs";
import path from "path";
import readline from "readline";
import inquirer from "inquirer";
import type SftpClient from "ssh2-sftp-client";
import { createApiClient } from "./api/client";
import { listWebsites } from "./api/hosting";
import {
  ensureSite,
  getActiveSite,
  getApiConfig,
  readConfig,
  writeConfig,
  type ConfigFile,
  type SiteConfig,
  type SftpAuth,
  type SftpConfig,
} from "./config";
import { clearRemoteDir, connectSftp, ensureRemoteDir, removeRemoteRecursive } from "./sftp/client";
import { syncDirectory } from "./sync/sync";
import { ensureWithinRoot, resolveFromCwd, normalizeRemotePath } from "./utils/path";
import { printWebsites } from "./utils/output";
import { createTempDir, openPath } from "./utils/open";

interface ParsedCommand {
  cmd: string;
  args: string[];
}

let suspendShellFn: (() => void) | undefined;
let resumeShellFn: (() => void) | undefined;

function parseArgs(input: string): ParsedCommand {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (char === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return { cmd: tokens[0] || "", args: tokens.slice(1) };
}

async function promptForSftpConfig(
  site: SiteConfig,
  preset?: Partial<SftpConfig>
): Promise<{ sftp: SftpConfig; remoteRoot: string }> {
  suspendShellFn?.();
  let answers = {} as {
    host?: string;
    port?: number;
    username?: string;
    authType?: string;
    password?: string;
    key?: string;
    passphrase?: string;
    remoteRoot?: string;
  };
  try {
    answers = await inquirer.prompt<{
    host?: string;
    port?: number;
    username?: string;
    authType?: string;
    password?: string;
    key?: string;
    passphrase?: string;
    remoteRoot?: string;
    }>([
    {
      type: "input",
      name: "host",
      message: "SFTP host",
      default: preset?.host,
    },
    {
      type: "number",
      name: "port",
      message: "SFTP port",
      default: preset?.port || 65002,
    },
    {
      type: "input",
      name: "username",
      message: "SFTP username",
      default: preset?.username || site.username,
    },
    {
      type: "input",
      name: "remoteRoot",
      message: "Remote root",
      default: site.remoteRoot || "/public_html",
    },
    {
      type: "list",
      name: "authType",
      message: "Authentication method",
      choices: ["password", "key"],
    },
    {
      type: "password",
      name: "password",
      message: "SFTP password",
      when: (response) => response.authType === "password",
    },
    {
      type: "input",
      name: "key",
      message: "Path to private key",
      when: (response) => response.authType === "key",
    },
    {
      type: "password",
      name: "passphrase",
      message: "Private key passphrase (optional)",
      when: (response) => response.authType === "key",
    },
    ]);
  } finally {
    resumeShellFn?.();
  }

  const host = (answers.host || "").toString();
  const port = Number(answers.port || 65002);
  const username = (answers.username || "").toString();
  const remoteRoot = (answers.remoteRoot || "/public_html").toString();

  if (!host || !username) {
    throw new Error("SFTP host and username are required.");
  }

  let auth: SftpAuth;
  if (answers.authType === "key") {
    const keyPath = (answers.key || "").toString();
    if (!keyPath) {
      throw new Error("Private key path is required.");
    }
    auth = {
      type: "key",
      privateKeyPath: keyPath,
      passphrase: (answers.passphrase || undefined)?.toString(),
    };
  } else {
    const password = (answers.password || "").toString();
    if (!password) {
      throw new Error("SFTP password is required.");
    }
    auth = {
      type: "password",
      password,
    };
  }

  return {
    sftp: { host, port, username, auth },
    remoteRoot,
  };
}

async function ensureSftp(site: SiteConfig, config: ConfigFile): Promise<SftpConfig> {
  if (site.sftp) {
    return site.sftp;
  }

  const configured = Object.values(config.sites)
    .map((existing) => existing.sftp)
    .filter((existing): existing is SftpConfig => !!existing);

  if (configured.length > 0) {
    const username = site.username;
    const match = configured.find((existing) => (username ? existing.username === username : false));
    if (match) {
      site.sftp = match;
      site.remoteRoot = site.remoteRoot || "/public_html";
      site.remoteCwd = site.remoteRoot;
      config.activeSite = site.domain;
      writeConfig(config);
      return match;
    }

    if (configured.length === 1) {
      site.sftp = configured[0];
      site.remoteRoot = site.remoteRoot || "/public_html";
      site.remoteCwd = site.remoteRoot;
      config.activeSite = site.domain;
      writeConfig(config);
      return configured[0];
    }
  }

  console.log("SFTP not configured for this project. Enter credentials now.");
  const { sftp, remoteRoot } = await promptForSftpConfig(site);
  site.sftp = sftp;
  site.remoteRoot = remoteRoot || site.remoteRoot || "/public_html";
  site.remoteCwd = site.remoteRoot;
  config.activeSite = site.domain;
  writeConfig(config);

  const { client, close } = await connectSftp(site.sftp);
  try {
    await autoDetectRoot(site, config, client, remoteRoot);
  } finally {
    await close();
  }
  return sftp;
}

async function withSftp<T>(site: SiteConfig, config: ConfigFile, handler: (client: SftpClient) => Promise<T>): Promise<T> {
  const sftp = await ensureSftp(site, config);
  const { client, close } = await connectSftp(sftp);
  try {
    return await handler(client);
  } finally {
    await close();
  }
}

function getPrompt(site?: SiteConfig): string {
  if (!site) {
    return "hostinger> ";
  }
  const cwd = site.remoteCwd || site.remoteRoot || "/public_html";
  return `hostinger(${site.domain}:${cwd})> `;
}

function resolveTarget(site: SiteConfig, target: string): string {
  const cwd = site.remoteCwd || site.remoteRoot || "/public_html";
  const resolved = resolveFromCwd(site.remoteRoot, cwd, target);
  return ensureWithinRoot(site.remoteRoot, resolved);
}

async function handleDomains(config: ConfigFile): Promise<void> {
  const client = createApiClient(config);
  const websites = await listWebsites(client);
  printWebsites(websites);
}

async function handleConnect(domain: string, config: ConfigFile): Promise<SiteConfig> {
  const client = createApiClient(config);
  const websites = await listWebsites(client, domain);
  const match = websites.find((site) => site.domain === domain);
  if (!match) {
    throw new Error(`Domain ${domain} not found in your account.`);
  }

  const site = ensureSite(config, domain);
  site.username = match.username;
  site.orderId = match.order_id;
  if (match.username) {
    site.remoteRoot = `/home/${match.username}/domains/${domain}/public_html`;
  } else {
    site.remoteRoot = site.remoteRoot || "/public_html";
  }
  site.remoteCwd = site.remoteCwd || site.remoteRoot;
  config.activeSite = domain;
  writeConfig(config);
  console.log(`Connected to ${domain}${match.username ? ` (user ${match.username})` : ""}.`);
  return site;
}

async function handleCd(target: string, site: SiteConfig, config: ConfigFile): Promise<void> {
  const resolved = resolveTarget(site, target);
  await withSftp(site, config, async (client) => {
    const type = await client.exists(resolved);
    if (type !== "d") {
      throw new Error(`Not a directory: ${resolved}`);
    }
  });

  site.remoteCwd = resolved;
  writeConfig(config);
}

async function handleLs(target: string | undefined, site: SiteConfig, config: ConfigFile): Promise<void> {
  const resolved = target ? resolveTarget(site, target) : site.remoteCwd || site.remoteRoot;
  if (!resolved) {
    throw new Error("No remote directory configured.");
  }

  await withSftp(site, config, async (client) => {
    const entries = await client.list(resolved);
    for (const entry of entries) {
      const suffix = entry.type === "d" ? "/" : "";
      console.log(`${entry.name}${suffix}`);
    }
  });
}

async function handleMkdir(target: string, site: SiteConfig, config: ConfigFile): Promise<void> {
  const resolved = resolveTarget(site, target);
  await withSftp(site, config, async (client) => {
    await ensureRemoteDir(client, resolved);
  });
  console.log(`Created ${resolved}`);
}

async function handleRm(args: string[], site: SiteConfig, config: ConfigFile): Promise<void> {
  const recursive = args.includes("-r") || args.includes("--recursive");
  const target = args.find((arg) => !arg.startsWith("-"));
  if (!target) {
    throw new Error("Usage: rm [-r] <remotePath>");
  }
  const resolved = resolveTarget(site, target);
  await withSftp(site, config, async (client) => {
    const type = await client.exists(resolved);
    if (!type) {
      throw new Error(`Remote path not found: ${resolved}`);
    }
    if (type === "d" && !recursive) {
      throw new Error("Remote path is a directory. Use -r to delete.");
    }
    await removeRemoteRecursive(client, resolved);
  });
  console.log(`Deleted ${resolved}`);
}

async function handlePut(args: string[], site: SiteConfig, config: ConfigFile): Promise<void> {
  const localPath = args[0];
  const remotePath = args[1];
  if (!localPath) {
    throw new Error("Usage: put <localPath> [remotePath]");
  }
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`);
  }

  const resolved = remotePath
    ? resolveTarget(site, remotePath)
    : resolveTarget(site, path.basename(localPath));

  await withSftp(site, config, async (client) => {
    await ensureRemoteDir(client, path.posix.dirname(resolved));
    await client.put(localPath, resolved);
  });

  console.log(`Uploaded ${localPath} -> ${resolved}`);
}

async function handleGet(args: string[], site: SiteConfig, config: ConfigFile): Promise<void> {
  const remotePath = args[0];
  const localPathArg = args[1];
  if (!remotePath) {
    throw new Error("Usage: get <remotePath> [localPath]");
  }

  const resolved = resolveTarget(site, remotePath);
  const localBase = localPathArg || path.join(process.cwd(), path.basename(resolved));

  await withSftp(site, config, async (client) => {
    const type = await client.exists(resolved);
    if (!type) {
      throw new Error(`Remote path not found: ${resolved}`);
    }

    if (type === "d") {
      const localDir = localBase;
      await downloadDirectory(client, resolved, localDir);
      console.log(`Downloaded directory to ${localDir}`);
    } else {
      await client.fastGet(resolved, localBase);
      console.log(`Downloaded file to ${localBase}`);
    }
  });
}

async function downloadDirectory(client: SftpClient, remoteDir: string, localDir: string): Promise<void> {
  fs.mkdirSync(localDir, { recursive: true });
  const entries = await client.list(remoteDir);
  for (const entry of entries) {
    const remoteChild = `${remoteDir}/${entry.name}`;
    const localChild = path.join(localDir, entry.name);
    if (entry.type === "d") {
      await downloadDirectory(client, remoteChild, localChild);
    } else {
      await client.fastGet(remoteChild, localChild);
    }
  }
}

async function handleReplaceUpdate(
  mode: "replace" | "update",
  args: string[],
  site: SiteConfig,
  config: ConfigFile
): Promise<void> {
  const localDir = args[0];
  const remoteDirArg = args[1];
  if (!localDir) {
    throw new Error(`${mode} <localDir> [remoteDir]`);
  }

  const localStat = fs.statSync(localDir);
  if (!localStat.isDirectory()) {
    throw new Error("Local path must be a directory.");
  }

  const remoteDir = remoteDirArg ? resolveTarget(site, remoteDirArg) : site.remoteCwd || site.remoteRoot;
  if (!remoteDir) {
    throw new Error("No remote directory configured.");
  }

  await withSftp(site, config, async (client) => {
    if (mode === "replace") {
      await clearRemoteDir(client, remoteDir);
    }
    const result = await syncDirectory({
      localDir,
      remoteDir,
      clean: false,
      dryRun: false,
      sftp: client,
    });
    console.log(`Uploaded: ${result.uploaded.length}`);
    console.log(`Skipped: ${result.skipped.length}`);
  });
}

async function handleOpen(args: string[], site: SiteConfig, config: ConfigFile): Promise<void> {
  const remotePath = args[0] || ".";
  const resolved = resolveTarget(site, remotePath);

  await withSftp(site, config, async (client) => {
    const type = await client.exists(resolved);
    if (!type) {
      throw new Error(`Remote path not found: ${resolved}`);
    }

    const tempDir = createTempDir("open");
    if (type === "d") {
      const localDir = path.join(tempDir, path.basename(resolved));
      await downloadDirectory(client, resolved, localDir);
      await openPath(localDir);
      return;
    }

    const localFile = path.join(tempDir, path.basename(resolved));
    await client.fastGet(resolved, localFile);
    await openPath(localFile);
  });
}

async function autoDetectRoot(
  site: SiteConfig,
  config: ConfigFile,
  client: SftpClient,
  fallbackRoot?: string
): Promise<void> {
  const candidates: string[] = [];
  const username = site.sftp?.username || site.username;

  if (username) {
    candidates.push(`/home/${username}/domains/${site.domain}/public_html`);
    candidates.push(`/home/${username}/domains/${site.domain}`);
  }

  if (fallbackRoot) {
    candidates.push(fallbackRoot);
  }

  candidates.push(site.remoteRoot || "/public_html");
  candidates.push(await client.realPath("."));

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = normalizeRemotePath(candidate);
    const exists = await client.exists(normalized);
    if (exists === "d") {
      site.remoteRoot = normalized;
      site.remoteCwd = normalized;
      writeConfig(config);
      return;
    }
  }
}

function printShellHelp(): void {
  console.log("Commands:");
  console.log("  help                         Show help");
  console.log("  domains                      List domains via Hostinger API");
  console.log("  connect <domain>             Set active domain");
  console.log("  disconnect                   Clear active domain");
  console.log("  pwd                          Show current remote directory");
  console.log("  root <absolutePath|auto>     Set remote root and cwd");
  console.log("  cd <path>                    Change remote directory");
  console.log("  ls [path]                    List remote directory");
  console.log("  mkdir <path>                 Create remote directory");
  console.log("  rm [-r] <path>               Remove file or directory");
  console.log("  put <local> [remote]         Upload file to remote");
  console.log("  get <remote> [local]         Download file or directory");
  console.log("  replace <local> [remote]     Replace remote dir contents");
  console.log("  update <local> [remote]      Add/update files, keep extras");
  console.log("  open [remote]                Download to temp and open");
  console.log("  exit                         Quit shell");
}

export async function startShell(): Promise<void> {
  const config = readConfig();
  const api = getApiConfig(config);
  if (!api.token) {
    console.log("Missing API token. Run `hostinger token set <token>` first.");
  }

  let currentSite = config.activeSite ? config.sites[config.activeSite] : undefined;

  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const ask = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));
  const suspendShell = () => {
    rl.close();
  };
  const resumeShell = () => {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
  };
  suspendShellFn = suspendShell;
  resumeShellFn = resumeShell;

  try {
    while (true) {
      const line = (await ask(getPrompt(currentSite))).trim();
      if (!line) {
        continue;
      }

      const parsed = parseArgs(line);
      const cmd = parsed.cmd.toLowerCase();
      const args = parsed.args;

      try {
        if (cmd === "exit" || cmd === "quit") {
          break;
        }

        if (cmd === "help") {
          printShellHelp();
          continue;
        }

        if (cmd === "clear") {
          console.clear();
          continue;
        }

        if (cmd === "domains") {
          await handleDomains(config);
          continue;
        }

        if (cmd === "connect") {
          if (!args[0]) {
            throw new Error("Usage: connect <domain>");
          }
          currentSite = await handleConnect(args[0], config);
          continue;
        }

        if (cmd === "disconnect") {
          config.activeSite = undefined;
          writeConfig(config);
          currentSite = undefined;
          console.log("Disconnected.");
          continue;
        }

        if (!currentSite) {
          throw new Error("No active site. Run `connect <domain>` first.");
        }

        if (cmd === "pwd") {
          console.log(currentSite.remoteCwd || currentSite.remoteRoot);
          continue;
        }

        if (cmd === "root") {
          if (!args[0]) {
            throw new Error("Usage: root <absolutePath>");
          }
          if (args[0] === "auto") {
            const site = currentSite;
            await withSftp(site, config, async (client) => {
              await autoDetectRoot(site, config, client);
              console.log(`Remote root set to ${site.remoteRoot}`);
            });
          } else {
            const rootPath = normalizeRemotePath(args[0]);
            currentSite.remoteRoot = rootPath;
            currentSite.remoteCwd = rootPath;
            writeConfig(config);
            console.log(`Remote root set to ${rootPath}`);
          }
          continue;
        }

        if (cmd === "cd") {
          if (!args[0]) {
            currentSite.remoteCwd = currentSite.remoteRoot;
            writeConfig(config);
            continue;
          }
          await handleCd(args[0], currentSite, config);
          continue;
        }

        if (cmd === "ls") {
          await handleLs(args[0], currentSite, config);
          continue;
        }

        if (cmd === "mkdir") {
          if (!args[0]) {
            throw new Error("Usage: mkdir <path>");
          }
          await handleMkdir(args[0], currentSite, config);
          continue;
        }

        if (cmd === "rm") {
          await handleRm(args, currentSite, config);
          continue;
        }

        if (cmd === "put") {
          await handlePut(args, currentSite, config);
          continue;
        }

        if (cmd === "get") {
          await handleGet(args, currentSite, config);
          continue;
        }

        if (cmd === "replace") {
          await handleReplaceUpdate("replace", args, currentSite, config);
          continue;
        }

        if (cmd === "update") {
          await handleReplaceUpdate("update", args, currentSite, config);
          continue;
        }

        if (cmd === "open") {
          await handleOpen(args, currentSite, config);
          continue;
        }

        console.log(`Unknown command: ${cmd}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    suspendShellFn = undefined;
    resumeShellFn = undefined;
    rl.close();
  }
}
