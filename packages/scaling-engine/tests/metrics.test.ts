import { describe, expect, it } from "vitest";
import { aggregateWindow, direction } from "../src";
import { days } from "./fixtures";

describe("aggregateWindow", () => {
  it("computes window KPIs", () => {
    const m = aggregateWindow(days(4), 4);
    expect(m.windowDays).toBe(4);
    expect(m.roas).toBeCloseTo(2.1);
    expect(m.cpa).toBe(20);
    expect(m.cpm).toBe(10);
    expect(m.ctr).toBeCloseTo(0.015);
    expect(m.dailyConversions).toBe(50);
    expect(m.prior).toBeNull();
  });
  it("compares to the prior window for WoW and trends", () => {
    const rows = days(8, {}, (i) => (i >= 4 ? { revenue: 1800, frequency: 3, impressions: 125_000 } : {}));
    const m = aggregateWindow(rows, 4);
    expect(m.roasDeltaWoW).toBeCloseTo(-1 / 7); // 2.1 → 1.8
    expect(m.frequencyTrend).toBe("up");
    expect(m.cpmTrend).toBe("down"); // same spend, more impressions
    expect(m.ctrTrend).toBe("down");
  });
  it("uses first vs second half of the window when there is no prior window", () => {
    const m = aggregateWindow(days(4, {}, (i) => ({ frequency: i < 2 ? 2 : 2.5 })), 7);
    expect(m.frequencyTrend).toBe("up");
  });
  it("reports day-over-day ROAS", () => {
    const m = aggregateWindow(days(3, {}, (i) => (i === 2 ? { revenue: 2310 } : {})), 3);
    expect(m.roasDeltaDoD).toBeCloseTo(0.1);
  });
  it("handles zero conversions without dividing by zero", () => {
    const m = aggregateWindow(days(3, { conversions: 0, revenue: 0 }), 3);
    expect(m.cpa).toBeNull();
    expect(m.roas).toBe(0);
  });
  it("rejects empty input", () => {
    expect(() => aggregateWindow([], 3)).toThrow();
  });
});

describe("direction", () => {
  it("uses a ±5% flat band", () => {
    expect(direction(0.04)).toBe("flat");
    expect(direction(0.06)).toBe("up");
    expect(direction(-0.2)).toBe("down");
    expect(direction(null)).toBe("flat");
  });
});
