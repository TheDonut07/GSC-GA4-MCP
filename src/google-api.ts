import { getGoogleAccessToken } from "./google-auth";
import type { Env } from "./env";

export async function googleFetch<T = any>(
  env: Env,
  url: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const token = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error?.message ?? text.slice(0, 500);
    let hint = "";
    if (res.status === 403) {
      hint =
        " — Make sure the service account email has been added as a user on this Search Console property / GA4 property, and that the API is enabled in your Google Cloud project.";
    } else if (res.status === 404) {
      hint = " — Check the site URL / property ID (use gsc_list_sites or ga4_list_properties).";
    }
    throw new Error(`Google API error ${res.status}: ${msg}${hint}`);
  }
  return data as T;
}
