import type { ApiClient } from "./client";

export interface Website {
  domain: string;
  username?: string;
  order_id?: number;
  is_enabled?: boolean;
}

export async function listWebsites(client: ApiClient, domain?: string): Promise<Website[]> {
  const params = domain ? `?domain=${encodeURIComponent(domain)}` : "";
  const response = await client.request<{ data?: Website[] } | Website[]>(
    `/api/hosting/v1/websites${params}`
  );

  if (Array.isArray(response)) {
    return response;
  }

  return response.data || [];
}
