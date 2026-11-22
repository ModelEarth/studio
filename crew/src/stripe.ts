import type { Env } from "./env";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_API_V2 = "https://api.stripe.com/v2";
const STRIPE_V2_VERSION = "2026-11-18.endive";
const SIGNATURE_TOLERANCE_SECONDS = 300;

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

export class StripeError extends Error {}

/** Calls the Stripe API with the crew account's secret key (STRIPE_CREW_SECRET_KEY). */
export async function stripe<T = any>(env: Env, method: "GET" | "POST", path: string, params?: Record<string, FormValue>): Promise<T> {
  if (!env.STRIPE_CREW_SECRET_KEY) throw new StripeError("STRIPE_CREW_SECRET_KEY is not set");
  const body = params ? formEncode(params) : undefined;
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_CREW_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? body : undefined,
  });
  const json = await response.json<any>();
  if (!response.ok) throw new StripeError(json?.error?.message ?? `Stripe request failed: ${response.status}`);
  return json as T;
}

/**
 * Calls Stripe's v2 API (JSON, with a pinned Stripe-Version), used to create connected
 * accounts: new Connect platforms can't create them with /v1/accounts. The v1 calls above
 * work with those accounts.
 */
export async function stripeV2<T = any>(env: Env, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!env.STRIPE_CREW_SECRET_KEY) throw new StripeError("STRIPE_CREW_SECRET_KEY is not set");
  const response = await fetch(`${STRIPE_API_V2}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_CREW_SECRET_KEY}`,
      "Content-Type": "application/json",
      "Stripe-Version": STRIPE_V2_VERSION,
    },
    body: method === "POST" && body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json<any>();
  if (!response.ok) throw new StripeError(json?.error?.message ?? `Stripe request failed: ${response.status}`);
  return json as T;
}

/** Checks a Stripe-Signature header (t=...,v1=...) against the raw request body. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS || signatures.length === 0) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function formEncode(params: Record<string, FormValue>): string {
  const pairs: string[] = [];
  const add = (key: string, value: FormValue) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => add(`${key}[${index}]`, item));
    } else if (typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) add(`${key}[${childKey}]`, childValue);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return pairs.join("&");
}
