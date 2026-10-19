import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, fmtMoney, fmtRoas, isoDate, relChange } from "../src";

describe("format", () => {
  it("formats money like the client sees it", () => {
    expect(fmtMoney(1000)).toBe("$1,000");
    expect(fmtMoney(18.5)).toBe("$18.50");
    expect(fmtMoney(2073.6)).toBe("$2,073.60");
    expect(fmtRoas(2)).toBe("2.0x");
  });
  it("computes relative change safely", () => {
    expect(relChange(2, 2.2)).toBeCloseTo(0.1);
    expect(relChange(0, 5)).toBeNull();
  });
  it("resolves calendar dates per time zone", () => {
    const d = new Date("2026-03-01T03:00:00Z");
    expect(isoDate(d)).toBe("2026-03-01");
    expect(isoDate(d, "America/Los_Angeles")).toBe("2026-02-28");
  });
});

describe("crypto", () => {
  const key = randomBytes(32).toString("base64");
  it("round-trips secrets", () => {
    const enc = encryptSecret("EAAB-token", key);
    expect(enc).not.toContain("EAAB");
    expect(decryptSecret(enc, key)).toBe("EAAB-token");
  });
  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("EAAB-token", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });
});
