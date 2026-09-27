import { describe, expect, test } from "vitest";
import { classifyUpdateError } from "./useAppUpdater";

describe("classifyUpdateError", () => {
  test("signature failures win over everything", () => {
    expect(classifyUpdateError(new Error("invalid signature: minisign verification failed"))).toBe("signature");
    expect(classifyUpdateError("pubkey mismatch, possible tampering")).toBe("signature");
  });

  test("network failures classify as offline", () => {
    expect(classifyUpdateError(new TypeError("fetch failed"))).toBe("offline");
    expect(classifyUpdateError(new Error("request timed out after 15000ms"))).toBe("offline");
    expect(classifyUpdateError(new Error("getaddrinfo ENOTFOUND github.com"))).toBe("offline");
    expect(classifyUpdateError(new Error("server returned 503"))).toBe("offline");
  });

  test("anything else stays other", () => {
    expect(classifyUpdateError(new Error("no update manifest found"))).toBe("other");
    expect(classifyUpdateError("weird string")).toBe("other");
    expect(classifyUpdateError(null)).toBe("other");
  });
});
