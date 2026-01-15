import fs from "fs";
import os from "os";
import path from "path";

export type AuthType = "password" | "key";

export interface SftpAuthPassword {
  type: "password";
  password: string;
}

export interface SftpAuthKey {
  type: "key";
  privateKeyPath: string;
  passphrase?: string;
}

export type SftpAuth = SftpAuthPassword | SftpAuthKey;

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  auth: SftpAuth;
}

export interface SiteConfig {
  domain: string;
  remoteRoot: string;
  sftp?: SftpConfig;
  username?: string;
  orderId?: number;
  remoteCwd?: string;
}

export interface ApiConfig {
  token?: string;
  baseUrl?: string;
}

export interface ConfigFile {
  api: ApiConfig;
  activeSite?: string;
  sites: Record<string, SiteConfig>;
}

const DEFAULT_BASE_URL = "https://developers.hostinger.com";

export function getConfigPath(): string {
  const platform = os.platform();
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "hostinger", "config.json");
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "hostinger", "config.json");
}

export function readConfig(): ConfigFile {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { api: {}, sites: {} };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as ConfigFile;
  return {
    api: parsed.api || {},
    activeSite: parsed.activeSite,
    sites: parsed.sites || {},
  };
}

export function writeConfig(config: ConfigFile): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function getApiConfig(config: ConfigFile): Required<ApiConfig> {
  const token = process.env.HOSTINGER_API_TOKEN || config.api.token || "";
  const baseUrl = process.env.HOSTINGER_BASE_URL || config.api.baseUrl || DEFAULT_BASE_URL;
  return { token, baseUrl };
}

export function getActiveSite(config: ConfigFile): SiteConfig {
  const active = config.activeSite;
  if (!active) {
    throw new Error("No active site. Run `hostinger connect <domain>` first.");
  }

  const site = config.sites[active];
  if (!site) {
    throw new Error(`Active site ${active} not found in config. Run connect again.`);
  }

  return site;
}

export function ensureSite(config: ConfigFile, domain: string): SiteConfig {
  if (!config.sites[domain]) {
    config.sites[domain] = {
      domain,
      remoteRoot: "/public_html",
    };
  }

  return config.sites[domain];
}
