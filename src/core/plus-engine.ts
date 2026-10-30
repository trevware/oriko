import { resultsFrom } from "./claude-engine";
import type { Depth, DescribeJob, EngineFailure, RunOutcome } from "./claude-engine";

/**
 * Trevware Plus, the paid engine: Describe on Trevware's server, for people
 * with no Claude Code and no Anthropic account. The server owns the prompt,
 * so a batch goes as structured jobs; this is that request and how each
 * answer the server gives is read. Pure; the calls are src/plus-engine.ts.
 */

export const PLUS_BASE = "https://plus.trevware.com";
/** Launched in 0.1.70: settings offer Trevware Plus and show Subscribe to anyone without a key. */
export const PLUS_LAUNCHED = true;
/** Marks a visit as coming from Oriko's settings, in the site's stats and in Polar's checkouts. */
const FROM_SETTINGS = "utm_source=oriko&utm_medium=settings";
/** Where Subscribe goes: the Polar checkout, with both plans. */
export const PLUS_CHECKOUT = `https://buy.polar.sh/polar_cl_pzcr2OMDKqtA0UBKHdiRqnI6h68WBHNIrLOst49JIJi?${FROM_SETTINGS}`;
/** Oriko's page, from the top: the Learn more link beside Subscribe. */
export const PLUS_PAGE = `https://trevware.com/plus/?${FROM_SETTINGS}`;
export const PLUS_PROTOCOL = 1;
/** Obsidian keychain id for the license key. */
export const LICENSE_SECRET = "oriko-plus-license";
/** Obsidian local storage key for this device's install id. */
export const INSTALL_KEY = "oriko-plus-install";
/** The server's cap on one picture, in base64 characters. */
export const PLUS_IMAGE_MAX = 1_000_000;
/**
 * The least Oriko waits for an answer from Trevware Plus: the server gives
 * Claude 45 seconds and may check the license with Polar first, so the 60
 * seconds Oriko gives a lone clip elsewhere could give up on an answer that
 * was on its way and charged.
 */
const PLUS_MIN_WAIT_MS = 90_000;

export function plusWait(timeoutMs: number): number {
  return Math.max(timeoutMs, PLUS_MIN_WAIT_MS);
}

/** The server's caps on text: title, description and domain, and the category list and each category. */
export const PLUS_LIMITS = { field: 500, terms: 500, term: 80 };

/** A whole Polar license key: an uppercase UUID, with the benefit's prefix in front when set. */
const KEY_SHAPE = /^(?:[A-Z0-9_]{1,32}-)?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export function looksLikeKey(key: string): boolean {
  return KEY_SHAPE.test(key.trim());
}

export interface PlusUsage {
  month: string;
  used: number;
  limit: number;
}

export interface PlusJob {
  id: number;
  image: string | null;
  title: string;
  description: string;
  domain: string;
  body: string;
}

export interface PlusBody {
  protocol: number;
  depth: Depth;
  vocabulary: string[];
  jobs: PlusJob[];
}

/** The batch as the server takes it: the note's path stays on the device. */
export function plusBody(jobs: DescribeJob[], vocabulary: string[], depth: Depth): PlusBody {
  const cut = (text: string) => text.slice(0, PLUS_LIMITS.field);
  return {
    protocol: PLUS_PROTOCOL,
    depth,
    // The wall's categories come most used first, so the cut keeps the ones that matter.
    vocabulary: vocabulary.filter((term) => term.length <= PLUS_LIMITS.term).slice(0, PLUS_LIMITS.terms),
    // A picture past the server's cap would fail the whole batch; that clip
    // is described from its text instead.
    jobs: jobs.map(({ id, image, title, description, domain, body }) => ({
      id,
      image: image && image.length <= PLUS_IMAGE_MAX ? image : null,
      title: cut(title),
      description: cut(description),
      domain: cut(domain),
      body,
    })),
  };
}

const FAILURES: Record<string, EngineFailure> = {
  "license-unknown": "license-rejected",
  "license-inactive": "license-inactive",
  "device-limit": "device-limit",
  "allowance-used": "allowance-used",
  unavailable: "plus-unavailable",
  "rate-limited": "rate-limit",
  overloaded: "rate-limit",
  // Every batch would be refused the same way: stop and say so.
  "bad-request": "plus-refused",
  // The server doesn't count clips it couldn't label, so they're retried one by one.
  timeout: "error",
};

/** What the server's answer means for the run, or that this device needs activating first. */
export function plusOutcome(status: number, body: unknown): RunOutcome | "not-activated" {
  const v = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status === 200 && Array.isArray(v.results)) {
    return { ok: true, results: resultsFrom({ items: v.results }) };
  }
  const code = typeof v.error === "string" ? v.error : "";
  const message = typeof v.message === "string" && v.message ? v.message : `Trevware Plus answered ${status}`;
  if (code === "not-activated") return "not-activated";
  return { ok: false, failure: FAILURES[code] ?? "error", message };
}

export function usageLine(usage: PlusUsage): string {
  const n = (value: number) => value.toLocaleString("en-US");
  return `${n(usage.used)} of ${n(usage.limit)} this month`;
}

/** How the device shows in the server's activations, and Polar's: platform and vault. */
export function installLabel(platform: string, vault: string): string {
  return `${platform} · ${vault}`.slice(0, 100);
}

export type Readiness = { ok: true } | { ok: false; failure: EngineFailure; message: string };

/**
 * Makes sure this device is activated before a run's batches go out, once for
 * all six lanes: without it each lane would send a whole batch only to hear
 * "not activated", then all six would try to activate at once. Remembered
 * per key until a batch says otherwise.
 */
export class ActivationGate {
  private key: string | null = null;
  private ready = false;
  private pending: Promise<Readiness> | null = null;

  constructor(private check: () => Promise<Readiness>) {}

  wait(key: string): Promise<Readiness> {
    if (this.key !== key) {
      this.key = key;
      this.ready = false;
      this.pending = null;
    }
    if (this.ready) return Promise.resolve({ ok: true });
    if (this.pending) return this.pending;
    const pending: Promise<Readiness> = this.check()
      // Every batch would fail the same way, so the run halts once.
      .catch((error: unknown): Readiness => ({
        ok: false,
        failure: "plus-unavailable",
        message: error instanceof Error ? error.message : String(error),
      }))
      .then((result) => {
        // A check overtaken by a new key speaks only for the lanes that asked for it.
        if (this.pending === pending) {
          this.pending = null;
          if (result.ok) this.ready = true;
        }
        return result;
      });
    this.pending = pending;
    return pending;
  }

  /** The device turned out not to be activated: check again, joining any check already running. */
  forget(): void {
    this.ready = false;
  }
}
