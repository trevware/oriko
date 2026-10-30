import { requestUrl } from "obsidian";
import { ActivationGate, PLUS_BASE, plusBody, plusOutcome, plusWait } from "./core/plus-engine";
import type { PlusUsage } from "./core/plus-engine";
import type { Depth, DescribeJob, EngineFailure, RunOutcome } from "./core/claude-engine";
import type { DescribeEngine } from "./core/describe-run";

/**
 * Trevware Plus's calls: Describe batches, and the account calls settings make
 * (activate this device, show usage, remove this device). The thin half; what
 * each answer means is in core/plus-engine.ts.
 */

/** Who is asking: the license key from the keychain, and this device's install id and label. */
export interface PlusIdentity {
  license(): string | null;
  install(): string;
  label(): string;
}

interface Answer {
  status: number;
  body: unknown;
}

/** The account as settings show it: active with usage, or why not, as the failure a run would halt on. */
export type PlusStatus = { ok: true; usage: PlusUsage } | { ok: false; failure: EngineFailure; message: string };

const ACCOUNT_TIMEOUT_MS = 20_000;

/** No answer in time. The request may still be running on the server. */
class NoAnswer extends Error {}

export class PlusAccount {
  constructor(private id: PlusIdentity) {}

  /**
   * One call to the server. requestUrl cannot be cancelled, so a timeout or an
   * abort settles at once and the late answer is dropped.
   */
  async call(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number, abort?: Promise<never>): Promise<Answer> {
    const key = this.id.license();
    const headers: Record<string, string> = { "X-Oriko-Install": this.id.install() };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new NoAnswer("Trevware Plus did not answer in time")), timeoutMs);
    });
    const request = requestUrl({
      url: `${PLUS_BASE}${path}`,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false,
    }).then((answer) => {
      let parsed: unknown = null;
      try {
        parsed = answer.json as unknown;
      } catch {
        // Not JSON: an outage page, which plusOutcome reads as a failed batch.
      }
      return { status: answer.status, body: parsed };
    });
    try {
      return await Promise.race(abort ? [request, timeout, abort] : [request, timeout]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  /**
   * The subscription as the server sees it, activating this device only if
   * the server says it isn't yet. Reading usage first keeps a settings page
   * that redraws from spending activation attempts, which are limited.
   */
  async status(): Promise<PlusStatus> {
    if (!this.id.license()) return { ok: false, failure: "license-rejected", message: "No license key is saved." };
    try {
      const answer = await this.call("GET", "/v1/usage", undefined, ACCOUNT_TIMEOUT_MS);
      if (plusOutcome(answer.status, answer.body) === "not-activated") return this.activate();
      return status(answer);
    } catch (error) {
      return { ok: false, failure: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Activates this device, or confirms it already is, and reads the usage. */
  async activate(): Promise<PlusStatus> {
    const key = this.id.license();
    if (!key) return { ok: false, failure: "license-rejected", message: "No license key is saved." };
    try {
      const answer = await this.call(
        "POST",
        "/v1/activate",
        { key, install: this.id.install(), label: this.id.label() },
        ACCOUNT_TIMEOUT_MS
      );
      return status(answer);
    } catch (error) {
      return { ok: false, failure: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Frees this device's activation, so the license can be used on another. */
  async deactivate(): Promise<boolean> {
    const key = this.id.license();
    if (!key) return false;
    try {
      const answer = await this.call("POST", "/v1/deactivate", { key, install: this.id.install() }, ACCOUNT_TIMEOUT_MS);
      // A key the server no longer knows (rotated, or its records cleared)
      // has no device here to free: removing it locally is all that's left.
      const unknown = plusOutcome(answer.status, answer.body);
      return answer.status === 200 || (unknown !== "not-activated" && !unknown.ok && unknown.failure === "license-rejected");
    } catch {
      return false;
    }
  }
}

function status(answer: Answer): PlusStatus {
  const v = answer.body && typeof answer.body === "object" ? (answer.body as Record<string, unknown>) : {};
  const usage = v.usage as PlusUsage | undefined;
  if (answer.status === 200 && usage && typeof usage.used === "number") return { ok: true, usage };
  const outcome = plusOutcome(answer.status, answer.body);
  if (outcome !== "not-activated" && !outcome.ok) return { ok: false, failure: outcome.failure, message: outcome.message };
  return { ok: false, failure: "error", message: `Trevware Plus answered ${answer.status}.` };
}

export class OrikoPlusEngine implements DescribeEngine {
  private cancels = new Set<(error: Error) => void>();
  /** One activation check for all of a run's lanes, before any batch goes out. */
  private gate: ActivationGate;

  constructor(
    private account: PlusAccount,
    private license: () => string | null
  ) {
    this.gate = new ActivationGate(() => this.account.status());
  }

  async run(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number, depth: Depth): Promise<RunOutcome> {
    const ready = await this.gate.wait(this.license() ?? "");
    if (!ready.ok) return { ok: false, failure: ready.failure, message: ready.message };
    const first = await this.describe(jobs, vocabulary, timeoutMs, depth);
    if (first !== "not-activated") return first;
    // Deactivated since the check (removed elsewhere, say): activate, then try once more.
    this.gate.forget();
    const activated = await this.gate.wait(this.license() ?? "");
    if (!activated.ok) return { ok: false, failure: activated.failure, message: activated.message };
    const second = await this.describe(jobs, vocabulary, timeoutMs, depth);
    // Still settling on the server: waited out and tried again like a rate
    // limit, never retried clip by clip, which would only fail ten times over.
    return second === "not-activated" ? { ok: false, failure: "rate-limit", message: "Trevware Plus is still activating this device" } : second;
  }

  private async describe(
    jobs: DescribeJob[],
    vocabulary: string[],
    timeoutMs: number,
    depth: Depth
  ): Promise<RunOutcome | "not-activated"> {
    let cancel: (error: Error) => void = () => undefined;
    const abort = new Promise<never>((_, reject) => {
      cancel = reject;
    });
    this.cancels.add(cancel);
    try {
      const answer = await this.account.call("POST", "/v1/describe", plusBody(jobs, vocabulary, depth), plusWait(timeoutMs), abort);
      return plusOutcome(answer.status, answer.body);
    } catch (error) {
      // Gone past the time limit, the batch may still be charged and finished
      // on the server: fail it, never retry its clips one by one.
      if (error instanceof NoAnswer) return { ok: false, failure: "batch-lost", message: error.message };
      return { ok: false, failure: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.cancels.delete(cancel);
    }
  }

  cancelAll(): void {
    for (const cancel of this.cancels) cancel(new Error("Stopped"));
    this.cancels.clear();
  }
}
