import type { DescribeJob, Depth, RawResult, RunOutcome } from "./claude-engine";
import type { DescribeContext, ReviewView } from "./commands";
import {
  BATCH_SIZE,
  BATCH_TIMEOUT_MS,
  CONCURRENCY,
  DEPTH_CAPS,
  EMPTY_PENDING,
  SINGLE_TIMEOUT_MS,
  addPending,
  batches,
  describedValues,
  fallbackWrites,
  inPool,
  matchResults,
  retainPending,
  snapshot,
  suggestionsFor,
  validate,
  wallVocabulary,
} from "./describe";
import type { PendingStore } from "./describe";
import { addedLabels } from "./describing";
import type { ClipStatus, RunSummary } from "./describing";
import type { FrontmatterWrite } from "./editable";
import type { HistoryEntry } from "./history";
import { ReviewSession } from "./review";
import type { ClippingRecord } from "./scan";

/**
 * A Describe run and the review that follows it: batching, retries, halts,
 * writes, undo, and the waiting suggestions. Pure, so every path through it
 * is tested with a fake engine; src/describe-service.ts supplies the real
 * engine, the media, the notices and the file the suggestions are kept in.
 */

export interface DescribeEngine {
  run(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number, depth: Depth): Promise<RunOutcome>;
  /** Ends every running call. Their runs resolve as errors. */
  cancelAll(): void;
}

export interface DescribeWriter {
  write(path: string, values: FrontmatterWrite): Promise<boolean>;
  record(entry: HistoryEntry): void;
}

export interface RunnerDeps {
  engine: DescribeEngine;
  /** A clipping's job (media and note text), or null when it is gone. */
  prepare(path: string, id: number): Promise<DescribeJob | null>;
  record(path: string): ClippingRecord | undefined;
  records(): readonly ClippingRecord[];
  save(store: PendingStore): Promise<void>;
  wait(ms: number): Promise<void>;
  /** How far the run has got, or null to take the count down. */
  progress(state: { done: number; total: number } | null): void;
  /** Each clip's step, for the wall to show on its tile. */
  status(path: string, status: ClipStatus): void;
  /** The run ended on its own or was stopped. A halted run says why through notify instead. */
  finished(summary: RunSummary): void;
  notify(text: string): void;
}

export interface RunnerOptions {
  batchSize: number;
  concurrency: number;
  rateLimitWaitMs: number;
  batchTimeoutMs: number;
  singleTimeoutMs: number;
}

export const RUNNER_DEFAULTS: RunnerOptions = {
  batchSize: BATCH_SIZE,
  concurrency: CONCURRENCY,
  rateLimitWaitMs: 20000,
  batchTimeoutMs: BATCH_TIMEOUT_MS,
  singleTimeoutMs: SINGLE_TIMEOUT_MS,
};

type Halt =
  | "not-logged-in"
  | "usage-limit"
  | "rate-limit"
  | "not-found"
  | "third-party"
  | "key-rejected"
  | "no-credit"
  | "license-rejected"
  | "license-inactive"
  | "device-limit"
  | "allowance-used"
  | "plus-unavailable"
  | "plus-refused";

/** Failures that would fail every batch after them, so the run stops at the first. */
const HALTING: ReadonlySet<string> = new Set<Halt>([
  "not-logged-in",
  "usage-limit",
  "not-found",
  "third-party",
  "key-rejected",
  "no-credit",
  "license-rejected",
  "license-inactive",
  "device-limit",
  "allowance-used",
  "plus-unavailable",
  "plus-refused",
]);

export const HALTS: Record<Halt, string> = {
  "not-logged-in":
    "Oriko: Claude Code says it is not signed in. Run claude in a terminal and sign in with /login, or switch Describe to an API key in Settings → Oriko.",
  "third-party":
    "Oriko: Anthropic is counting Describe as third-party app usage, billed from extra usage, so Describe stopped. You can switch Describe to an API key in Settings → Oriko.",
  "key-rejected": "Oriko: Anthropic rejected the API key. Check it in Settings → Oriko.",
  "license-rejected": "Oriko: Trevware Plus doesn't recognize this license key. Check it in Settings → Oriko.",
  "license-inactive":
    "Oriko: your Trevware Plus subscription isn't active. Describing stopped; what was described is kept.",
  "device-limit":
    "Oriko: this license is already on 5 devices. Remove one in Settings → Oriko on that device, then describe again.",
  "allowance-used":
    "Oriko: you've used this month's Trevware Plus allowance. Describing stopped; what was described is kept. It resets on the 1st.",
  "plus-unavailable": "Oriko: Trevware Plus isn't available right now. Describing stopped; what was described is kept.",
  "plus-refused":
    "Oriko: Trevware Plus couldn't read what this version of Oriko sent. Describing stopped; update Oriko, then describe again.",
  "no-credit":
    "Oriko: the Anthropic API key Describe is billing is out of credit. Describing stopped; what was described is kept. Settings → Oriko shows which key is in use.",
  "usage-limit": "Oriko: your Claude usage limit is reached. Describing stopped; what was described is kept.",
  "rate-limit":
    "Oriko: requests are being limited right now. Describing stopped; what was described is kept. Try again in a few minutes.",
  "not-found": "Oriko: Claude Code was not found. Check Settings → Oriko → Claude Code path.",
};

export interface RunRequest {
  /** How deep the labels go. Standard when absent. */
  depth?: Depth;
  /**
   * The user picked these clippings: labels are added to ones that already
   * have some, and they can get suggestions. The bulk run leaves this off.
   */
  selected?: boolean;
}

interface Written {
  path: string;
  before: FrontmatterWrite;
  after: FrontmatterWrite;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function entry(label: string, written: Written[], writer: DescribeWriter): HistoryEntry {
  return {
    label,
    undo: async () => {
      for (const w of written) await writer.write(w.path, w.before);
    },
    redo: async () => {
      for (const w of written) await writer.write(w.path, w.after);
    },
  };
}

export class DescribeRunner {
  private running = false;
  /** No new batches start: the user stopped the run, or it halted on a problem. */
  private stopped = false;
  /** The user stopped the run: work on its way is dropped too. */
  private cancelled = false;
  private halted: string | null = null;
  private done = 0;
  private total = 0;
  private failed: string[] = [];
  /** Paths this run has counted, done or failed, so a lane that throws fails only the rest. */
  private handled = new Set<string>();
  /** Terms this run suggested, for its summary. */
  private suggested = new Set<string>();
  private pending: PendingStore = EMPTY_PENDING;
  /** The review, built on first use and rebuilt when the waiting suggestions change. */
  private session: ReviewSession | null = null;
  /** The last run's request, so a retry asks for the same depth. */
  private request: Required<RunRequest> = { depth: "standard", selected: false };

  constructor(
    private deps: RunnerDeps,
    private options: RunnerOptions = RUNNER_DEFAULTS
  ) {}

  setPending(store: PendingStore): void {
    this.pending = store;
    this.session = null;
  }

  get busy(): boolean {
    return this.running;
  }

  context(uncategorized: string[]): DescribeContext {
    return {
      running: this.running,
      done: this.done,
      total: this.total,
      uncategorized,
      failed: this.failed.length,
      review: this.reviewView(),
    };
  }

  private review(): ReviewSession {
    this.session ??= new ReviewSession(this.pending);
    return this.session;
  }

  private reviewView(): ReviewView | null {
    if (this.pending.terms.length === 0) return null;
    const session = this.review();
    const clip = session.current();
    if (!clip) return null;
    return {
      position: session.position,
      total: session.total,
      path: clip.path,
      terms: clip.terms.map((t) => ({ ...t, ticked: session.isTicked(clip.path, t.term) })),
      counts: session.counts(),
    };
  }

  async describe(paths: string[], writer: DescribeWriter, request: RunRequest = {}): Promise<void> {
    if (this.running || paths.length === 0) return;
    this.request = { depth: request.depth ?? "standard", selected: request.selected ?? false };
    this.running = true;
    this.stopped = false;
    this.cancelled = false;
    this.halted = null;
    this.done = 0;
    this.total = paths.length;
    this.failed = [];
    this.handled = new Set();
    this.suggested = new Set();
    const vocabulary = wallVocabulary(this.deps.records());
    const written: Written[] = [];
    this.deps.progress(this.progress());

    try {
      await inPool(
        batches(paths, this.options.batchSize),
        this.options.concurrency,
        (group) => this.runGroup(group, vocabulary, writer, written),
        // A lane that throws fails only what it had not counted yet; the
        // other lanes carry on, and the run still ends with its undo entry.
        (group) => {
          for (const path of group) if (!this.handled.has(path)) this.fail(path);
        }
      );
    } finally {
      this.deps.engine.cancelAll();
      this.running = false;
      // A stop or a halt leaves clips that never landed: their tiles let go.
      for (const path of paths) if (!this.handled.has(path)) this.deps.status(path, { step: "cleared" });
      if (written.length > 0) {
        writer.record(entry(`Describe ${plural(written.length, "clipping", "clippings")}`, written, writer));
      }
      await this.deps.save(this.pending);
      // Suggestions this run added join the review; ticks on clips still waiting carry over.
      if (this.session) this.session = new ReviewSession(this.pending, this.session);
      // Down only now, beside the closing line, so nothing reads as finished
      // while the suggestions are still being saved.
      this.deps.progress(null);
      // A halted run said why when it halted.
      if (!this.halted) this.deps.finished(this.summary(written.length));
    }
  }

  retryFailed(writer: DescribeWriter): Promise<void> {
    return this.describe([...this.failed], writer, this.request);
  }

  stop(): void {
    if (!this.running) return;
    this.stopped = true;
    this.cancelled = true;
    this.deps.engine.cancelAll();
  }

  toggle(path: string, term: string): void {
    this.review().toggle(path, term);
  }

  /** Moves the review one clip, and marks the clip it lands on as seen. */
  step(delta: 1 | -1): void {
    const session = this.review();
    session.step(delta);
    session.markShown();
  }

  /** The review stage is on screen, so its current clip has been seen. */
  shown(): void {
    this.review().markShown();
  }

  async apply(writer: DescribeWriter): Promise<void> {
    if (this.running) {
      this.deps.notify("Oriko: wait for describing to finish, then apply the review");
      return;
    }
    const session = this.review();
    const { writes, skipped } = session.writes(this.pending, (path) => this.deps.record(path)?.categories ?? null);
    const labels = session.counts().labels;
    const written: Written[] = [];
    const failed: string[] = [];
    for (const write of writes) {
      const record = this.deps.record(write.path);
      if (!record) continue;
      const after: FrontmatterWrite = { categories: write.categories };
      const before = snapshot(record, after);
      if (await writer.write(write.path, after)) written.push({ path: write.path, before, after });
      else failed.push(write.path);
    }

    this.pending = session.remaining(this.pending, failed);
    this.session = new ReviewSession(this.pending, session);
    await this.deps.save(this.pending);
    if (written.length > 0) {
      writer.record(entry(`Apply ${plural(labels, "suggested label", "suggested labels")}`, written, writer));
    }

    const parts = [`categories updated on ${plural(written.length, "clipping", "clippings")}`];
    if (skipped > 0) parts.push(`${skipped} skipped (renamed or deleted)`);
    if (failed.length > 0) parts.push(`${failed.length} failed (kept for the next review)`);
    this.deps.notify(`Oriko: ${parts.join(", ")}`);
  }

  /** Drops the suggestions of the clip on show; the review moves on to the next clip. */
  async discardClip(writer: DescribeWriter): Promise<void> {
    const clip = this.review().current();
    if (clip) await this.discard([clip.path], writer, false);
  }

  /** Drops every waiting suggestion, which takes the review away. */
  async discardAll(writer: DescribeWriter): Promise<void> {
    await this.discard([...new Set(this.pending.terms.flatMap((t) => t.paths))], writer, true);
  }

  /**
   * The review changes first and the writes follow, so the palette, which
   * re-renders as soon as the action returns, already shows the next clip.
   */
  private async discard(paths: string[], writer: DescribeWriter, all: boolean): Promise<void> {
    if (this.running) {
      this.deps.notify("Oriko: wait for describing to finish, then discard suggestions");
      return;
    }
    const planned = fallbackWrites(this.pending, paths, (path) => this.deps.record(path)?.categories ?? null).flatMap(
      (write) => {
        const record = this.deps.record(write.path);
        if (!record) return [];
        const after: FrontmatterWrite = { categories: write.categories };
        return [{ path: write.path, before: snapshot(record, after), after }];
      }
    );

    const drop = new Set(paths);
    const keep = [...new Set(this.pending.terms.flatMap((t) => t.paths))].filter((path) => !drop.has(path));
    const previous = this.review();
    this.pending = retainPending(this.pending, keep);
    this.session = this.pending.terms.length > 0 ? new ReviewSession(this.pending, previous) : null;
    this.session?.markShown();

    const written: Written[] = [];
    for (const w of planned) if (await writer.write(w.path, w.after)) written.push(w);
    await this.deps.save(this.pending);
    if (written.length > 0) {
      writer.record(entry(`Discard suggestions for ${plural(paths.length, "clip", "clips")}`, written, writer));
    }
    if (all) this.deps.notify("Oriko: suggestions discarded");
  }

  private progress(): { done: number; total: number } {
    return { done: this.done, total: this.total };
  }

  private summary(described: number): RunSummary {
    return {
      described,
      failed: this.failed.length,
      suggested: this.suggested.size,
      stopped: this.stopped,
    };
  }

  private tick(path: string, status: ClipStatus = { step: "cleared" }): void {
    this.handled.add(path);
    this.done++;
    this.deps.status(path, status);
    this.deps.progress(this.progress());
  }

  private fail(path: string): void {
    this.failed.push(path);
    this.tick(path, { step: "failed" });
  }

  /**
   * Stops the run on a problem. Nothing new starts, but batches already on
   * their way are left to land: their clips were sent and, on Trevware Plus,
   * paid for, so throwing their answers away would waste them.
   */
  private halt(reason: Halt): void {
    if (this.halted === null) {
      this.halted = HALTS[reason];
      // Said now, while batches already out are still landing.
      this.deps.notify(this.halted);
    }
    this.stopped = true;
  }

  private async jobsFor(paths: string[]): Promise<DescribeJob[]> {
    const jobs = await Promise.all(paths.map((path, id) => this.deps.prepare(path, id)));
    return jobs.filter((job): job is DescribeJob => job !== null);
  }

  /**
   * One engine call. A rate limit is waited out once; one that outlasts the
   * wait halts the run, as does every failure in HALTING: a missing login or
   * Claude Code, a usage limit, third-party billing, a refused key or an empty
   * account. Each of those would fail every clipping that follows.
   */
  private async runJobs(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number): Promise<RunOutcome> {
    const depth = this.request.depth;
    let outcome = await this.deps.engine.run(jobs, vocabulary, timeoutMs, depth);
    if (!outcome.ok && outcome.failure === "rate-limit" && !this.stopped) {
      await this.deps.wait(this.options.rateLimitWaitMs);
      if (this.stopped) return outcome;
      outcome = await this.deps.engine.run(jobs, vocabulary, timeoutMs, depth);
      if (!outcome.ok && outcome.failure === "rate-limit") this.halt("rate-limit");
    }
    if (!outcome.ok && HALTING.has(outcome.failure)) this.halt(outcome.failure as Halt);
    return outcome;
  }

  private async runGroup(
    paths: string[],
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    if (this.stopped) return;
    const before = this.pending;
    try {
      await this.describeGroup(paths, vocabulary, writer, written);
    } finally {
      // Saved as each batch finishes, so a force-quit mid-run cannot strand a
      // captioned clipping with no categories and no suggestion on record.
      if (this.pending !== before) await this.deps.save(this.pending);
    }
  }

  private async describeGroup(
    paths: string[],
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    const jobs = await this.jobsFor(paths);
    // A clipping deleted since the run began has nothing to describe.
    const found = new Set(jobs.map((job) => job.path));
    for (const path of paths) if (!found.has(path)) this.tick(path);
    if (jobs.length === 0 || this.stopped) return;

    for (const job of jobs) this.deps.status(job.path, { step: "describing" });
    const timeout = jobs.length > 1 ? this.options.batchTimeoutMs : this.options.singleTimeoutMs;
    const outcome = await this.runJobs(jobs, vocabulary, timeout);
    if (this.cancelled) return;
    // Halted while this batch was out: keep what came back, start nothing
    // more, and fail the rest so Retry failed picks them up.
    if (this.stopped) {
      const { matched, missing } = outcome.ok ? matchResults(jobs, outcome.results) : { matched: [], missing: jobs };
      for (const [job, raw] of matched) await this.accept(job.path, raw, vocabulary, writer, written);
      for (const job of missing) this.fail(job.path);
      return;
    }
    if (!outcome.ok && outcome.failure === "batch-lost") {
      // Retrying singly would pay for the same clips again; Retry failed
      // picks them up later, at no cost if the lost batch was refunded.
      for (const job of jobs) this.fail(job.path);
      return;
    }
    if (!outcome.ok) {
      await this.runSingly(jobs, vocabulary, writer, written);
      return;
    }
    const { matched, missing } = matchResults(jobs, outcome.results);
    for (const [job, raw] of matched) await this.accept(job.path, raw, vocabulary, writer, written);
    await this.runSingly(missing, vocabulary, writer, written);
  }

  /** Retries jobs one per call, so one bad clipping cannot fail its batch. */
  private async runSingly(
    jobs: DescribeJob[],
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    for (const [index, job] of jobs.entries()) {
      if (this.stopped) {
        // Halted with these still to retry: failed, so Retry failed finds
        // them. A run the user stopped leaves them as they were.
        if (!this.cancelled) for (const rest of jobs.slice(index)) this.fail(rest.path);
        return;
      }
      const outcome = await this.runJobs([{ ...job, id: 0 }], vocabulary, this.options.singleTimeoutMs);
      // Halted while it was out, the answer is still kept: it was sent and paid for.
      if (this.cancelled) return;
      const raw = outcome.ok ? outcome.results.find((r) => r.caption.trim()) : undefined;
      if (raw) await this.accept(job.path, raw, vocabulary, writer, written);
      else this.fail(job.path);
    }
  }

  private async accept(
    path: string,
    raw: RawResult,
    vocabulary: string[],
    writer: DescribeWriter,
    written: Written[]
  ): Promise<void> {
    const record = this.deps.record(path);
    if (!record) {
      this.tick(path);
      return;
    }
    const { depth, selected } = this.request;
    const cap = DEPTH_CAPS[depth];
    const described = validate(raw, path, vocabulary, depth);
    const after = describedValues(record.categories, described, { add: selected, cap });
    const before = snapshot(record, after);
    if (await writer.write(path, after)) {
      written.push({ path, before, after });
      const offered = suggestionsFor(record.categories, described, { selected, cap });
      for (const proposal of offered.proposals) this.suggested.add(proposal.term);
      this.pending = addPending(this.pending, offered);
      this.tick(path, {
        step: "labelled",
        added: addedLabels(record.categories, after),
        review: offered.proposals.length,
      });
    } else {
      this.fail(path);
    }
  }
}
