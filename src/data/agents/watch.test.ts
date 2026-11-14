import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WATCH_INTERVAL_MS, WATCH_MAX_MS, watchFor } from "./watch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watching for a new connection", () => {
  it("looks every 3 seconds and stops at the first hit", async () => {
    expect(WATCH_INTERVAL_MS).toBe(3000);
    let calls = 0;
    const found: string[] = [];
    watchFor({
      check: async () => (++calls === 3 ? "agent" : null),
      onFound: (v) => found.push(v),
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls).toBe(3);
    expect(found).toEqual(["agent"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
  });

  it("stops when it is stopped (the dialog closed), even with a check in flight", async () => {
    let calls = 0;
    const found: string[] = [];
    let release: (v: string | null) => void = () => undefined;
    const stop = watchFor({
      check: () => {
        calls++;
        return new Promise<string | null>((r) => (release = r));
      },
      onFound: (v) => found.push(v),
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(1);
    stop();
    release("late");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
    expect(found).toEqual([]);
    stop(); // twice is harmless
  });

  it("never runs two checks at once", async () => {
    let running = 0;
    let most = 0;
    const stop = watchFor({
      check: async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 10_000));
        running--;
        return null;
      },
      onFound: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    expect(most).toBe(1);
  });

  it("gives up after 10 minutes", async () => {
    expect(WATCH_MAX_MS).toBe(600_000);
    let calls = 0;
    watchFor({
      check: async () => {
        calls++;
        return null;
      },
      onFound: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(WATCH_MAX_MS + 30_000);
    const atEnd = calls;
    expect(atEnd).toBeGreaterThanOrEqual(199);
    expect(atEnd).toBeLessThanOrEqual(200);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(atEnd);
  });

  it("treats a failed check as 'not yet' and keeps looking", async () => {
    let calls = 0;
    const found: number[] = [];
    watchFor({
      check: async () => {
        if (++calls < 3) throw new Error("offline");
        return calls;
      },
      onFound: (v) => found.push(v),
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(found).toEqual([3]);
  });
});
