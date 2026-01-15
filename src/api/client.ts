import { getApiConfig } from "../config";
import type { ConfigFile } from "../config";

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
}

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "User-Agent": "hostinger-cli/0.1.0",
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    if (init?.headers) {
      Object.assign(headers, init.headers as Record<string, string>);
    }

    const response = await fetch(url, { ...init, headers });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`API ${response.status} ${response.statusText}: ${text}`);
    }

    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }
}

export function createApiClient(config: ConfigFile): ApiClient {
  const api = getApiConfig(config);
  if (!api.token) {
    throw new Error("Missing API token. Run `hostinger token set <token>` or set HOSTINGER_API_TOKEN.");
  }
  return new ApiClient(api);
}
