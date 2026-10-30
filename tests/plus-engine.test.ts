import { describe, expect, it } from "vitest";
import {
  ActivationGate,
  PLUS_CHECKOUT,
  PLUS_IMAGE_MAX,
  PLUS_LIMITS,
  PLUS_PAGE,
  plusBody,
  plusWait,
  plusOutcome,
  installLabel,
  looksLikeKey,
  usageLine,
} from "../src/core/plus-engine";
import type { DescribeJob } from "../src/core/claude-engine";

const job = (over: Partial<DescribeJob> = {}): DescribeJob => ({
  id: 0,
  path: "Clippings/A.md",
  image: "/9j/AAAA",
  title: "A",
  description: "",
  domain: "example.com",
  body: "",
  ...over,
});

const item = (id: number) => ({ id, categories: ["design"], proposals: [], fallback: "design", caption: "A poster.", media_text: "" });

describe("plusBody", () => {
  it("sends structured jobs without the note's path, never prompt text", () => {
    const body = plusBody([job(), job({ id: 1, image: null })], ["design"], "specific");
    expect(body).toEqual({
      protocol: 1,
      depth: "specific",
      vocabulary: ["design"],
      jobs: [
        { id: 0, image: "/9j/AAAA", title: "A", description: "", domain: "example.com", body: "" },
        { id: 1, image: null, title: "A", description: "", domain: "example.com", body: "" },
      ],
    });
  });
});

describe("plusBody limits", () => {
  it("sends a picture past the server's cap as no picture, so one clip can't sink its batch", () => {
    const body = plusBody([job({ image: "/9j/" + "A".repeat(PLUS_IMAGE_MAX) })], [], "standard");
    expect(body.jobs[0].image).toBeNull();
    expect(PLUS_IMAGE_MAX).toBe(1_000_000);
  });
});

describe("plusBody text limits", () => {
  it("cuts long text and the category list to what the server takes, so no clip sinks its batch", () => {
    const body = plusBody(
      [job({ title: "t".repeat(800), description: "d".repeat(800), domain: "x".repeat(600) })],
      [...Array.from({ length: 600 }, (_, i) => `term-${i}`), "y".repeat(120)],
      "standard"
    );
    expect(body.jobs[0].title.length).toBe(PLUS_LIMITS.field);
    expect(body.jobs[0].description.length).toBe(PLUS_LIMITS.field);
    expect(body.jobs[0].domain.length).toBe(PLUS_LIMITS.field);
    expect(body.vocabulary.length).toBe(PLUS_LIMITS.terms);
    expect(body.vocabulary.every((term) => term.length <= PLUS_LIMITS.term)).toBe(true);
    expect(PLUS_LIMITS).toEqual({ field: 500, terms: 500, term: 80 });
  });

  it("drops overlong categories before cutting the list, keeping the most used", () => {
    const body = plusBody([job()], ["design", "z".repeat(81), "food"], "standard");
    expect(body.vocabulary).toEqual(["design", "food"]);
  });
});

describe("ActivationGate", () => {
  it("checks once for all the lanes of a run", async () => {
    let checks = 0;
    const gate = new ActivationGate(async () => {
      checks++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true };
    });
    const all = await Promise.all(Array.from({ length: 6 }, () => gate.wait("KEY")));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(checks).toBe(1);
    await gate.wait("KEY");
    expect(checks).toBe(1);
  });

  it("checks again for a new key, after a failure, or when told to forget", async () => {
    let checks = 0;
    let answer: { ok: true } | { ok: false; failure: "device-limit"; message: string } = { ok: false, failure: "device-limit", message: "full" };
    const gate = new ActivationGate(async () => {
      checks++;
      return answer;
    });
    expect(await gate.wait("KEY")).toMatchObject({ ok: false, failure: "device-limit" });
    answer = { ok: true };
    expect(await gate.wait("KEY")).toMatchObject({ ok: true });
    await gate.wait("OTHER");
    gate.forget();
    await gate.wait("OTHER");
    expect(checks).toBe(4);
  });
});

describe("PLUS_PAGE", () => {
  it("opens Oriko's page at the top, marked as coming from settings", () => {
    expect(PLUS_PAGE).toBe("https://trevware.com/plus/?utm_source=oriko&utm_medium=settings");
  });
});

describe("PLUS_CHECKOUT", () => {
  it("opens the checkout marked as coming from settings", () => {
    const url = new URL(PLUS_CHECKOUT);
    expect(url.origin + url.pathname).toBe("https://buy.polar.sh/polar_cl_pzcr2OMDKqtA0UBKHdiRqnI6h68WBHNIrLOst49JIJi");
    expect(url.searchParams.get("utm_source")).toBe("oriko");
    expect(url.searchParams.get("utm_medium")).toBe("settings");
  });
});

describe("plusWait", () => {
  it("waits long enough for the server's own limit and a license check on a lone clip", () => {
    expect(plusWait(60_000)).toBe(90_000);
    expect(plusWait(120_000)).toBe(120_000);
  });
});

describe("ActivationGate, as lanes come and go", () => {
  function deferred() {
    let resolve: (value: { ok: true }) => void = () => undefined;
    const promise = new Promise<{ ok: true }>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("lets a lane that hears 'not activated' join a check already running", async () => {
    let checks = 0;
    const d = deferred();
    const gate = new ActivationGate(() => (checks++, d.promise));
    const first = gate.wait("KEY");
    gate.forget();
    const second = gate.wait("KEY");
    d.resolve({ ok: true });
    await Promise.all([first, second]);
    expect(checks).toBe(1);
  });

  it("stops the run on a check that throws, and checks afresh next time", async () => {
    let checks = 0;
    const gate = new ActivationGate(async () => {
      checks++;
      if (checks === 1) throw new Error("keychain unavailable");
      return { ok: true };
    });
    // Every batch would fail the same way: halt once, never retry ten clips singly.
    expect(await gate.wait("KEY")).toMatchObject({ ok: false, failure: "plus-unavailable" });
    expect(await gate.wait("KEY")).toEqual({ ok: true });
  });

  it("never counts a check of one key as a check of the next", async () => {
    const checks: Array<ReturnType<typeof deferred>> = [];
    const gate = new ActivationGate(() => {
      const d = deferred();
      checks.push(d);
      return d.promise;
    });
    void gate.wait("A");
    const b = gate.wait("B");
    checks[0].resolve({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let settled = false;
    void gate.wait("B").then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    checks[1].resolve({ ok: true });
    await b;
    expect(checks).toHaveLength(2);
  });
});

describe("looksLikeKey", () => {
  it("knows a whole license key from a half-typed one", () => {
    expect(looksLikeKey("ORIKO-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA")).toBe(true);
    expect(looksLikeKey("1c285b2d-6ce6-4bc7-b8be-adb6a7e304da")).toBe(true);
    expect(looksLikeKey("ORIKO-1C285B2D-6CE6")).toBe(false);
    expect(looksLikeKey("")).toBe(false);
  });
});

describe("plusOutcome", () => {
  it("reads the server's results", () => {
    const run = plusOutcome(200, { results: [item(0), item(1)], usage: { month: "2026-10", used: 2, limit: 1000 } });
    expect(run).toMatchObject({ ok: true });
    if (run !== "not-activated" && run.ok) expect(run.results.map((r) => r.id)).toEqual([0, 1]);
  });

  it("asks for activation when the device is not activated yet", () => {
    expect(plusOutcome(409, { error: "not-activated", message: "" })).toBe("not-activated");
  });

  it("halts on a key, subscription, device or allowance problem, and when the service is unavailable", () => {
    const cases: [number, string, string][] = [
      [401, "license-unknown", "license-rejected"],
      [403, "license-inactive", "license-inactive"],
      [403, "device-limit", "device-limit"],
      [402, "allowance-used", "allowance-used"],
      [503, "unavailable", "plus-unavailable"],
    ];
    for (const [status, error, failure] of cases) {
      expect(plusOutcome(status, { error, message: "m" })).toMatchObject({ ok: false, failure });
    }
  });

  it("waits out a rate limit or an overloaded service", () => {
    expect(plusOutcome(429, { error: "rate-limited", message: "" })).toMatchObject({ failure: "rate-limit" });
    expect(plusOutcome(503, { error: "overloaded", message: "" })).toMatchObject({ failure: "rate-limit" });
  });

  it("stops the run when the server can't read what Oriko sent, since every batch would fail the same way", () => {
    expect(plusOutcome(400, { error: "bad-request", message: "" })).toMatchObject({ failure: "plus-refused" });
  });

  it("retries clip by clip a batch Claude ran out of time on, since the server doesn't count it", () => {
    expect(plusOutcome(504, { error: "timeout", message: "" })).toMatchObject({ failure: "error" });
  });

  it("fails only the batch on anything else, including an answer that is not the server's", () => {
    expect(plusOutcome(500, { error: "server-error", message: "" })).toMatchObject({ failure: "error" });
    expect(plusOutcome(502, { error: "upstream", message: "" })).toMatchObject({ failure: "error" });
    expect(plusOutcome(500, "<html>")).toMatchObject({ failure: "error" });
    expect(plusOutcome(200, { nothing: true })).toMatchObject({ failure: "error" });
  });
});

describe("usageLine", () => {
  it("says how much of the month is used", () => {
    expect(usageLine({ month: "2026-10", used: 212, limit: 1000 })).toBe("212 of 1,000 this month");
    expect(usageLine({ month: "2026-10", used: 1000, limit: 1000 })).toBe("1,000 of 1,000 this month");
  });
});

describe("installLabel", () => {
  it("names the device by platform and vault, within the server's limit", () => {
    expect(installLabel("macOS", "Aegis")).toBe("macOS · Aegis");
    expect(installLabel("macOS", "x".repeat(200)).length).toBeLessThanOrEqual(100);
  });
});
