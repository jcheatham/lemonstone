import { describe, it, expect } from "vitest";
import { classifyConnectionFailure } from "../src/s3/connection-test.ts";
import type { ConnectionProbeResult } from "../src/s3/s3-session.ts";

describe("classifyConnectionFailure", () => {
  it("passes through a successful probe", () => {
    const probe: ConnectionProbeResult = { ok: true };
    expect(classifyConnectionFailure(probe)).toEqual({ ok: true, raw: probe });
  });

  it("classifies a bare fetch failure (no HTTP status) as cors-or-region", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "headBucket",
      message: "Failed to fetch",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.ok).toBe(false);
    expect(outcome.category).toBe("cors-or-region");
    expect(outcome.guidance).toMatch(/CORS/);
  });

  it("classifies 403 as forbidden", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "listObjects",
      httpStatusCode: 403,
      errorName: "AccessDenied",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("forbidden");
    expect(outcome.guidance).toMatch(/IAM policy/);
  });

  it("classifies 404 on headBucket as not-found", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "headBucket",
      httpStatusCode: 404,
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("not-found");
  });

  it("classifies InvalidAccessKeyId as bad-credentials even with an HTTP status", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "headBucket",
      httpStatusCode: 403,
      errorName: "InvalidAccessKeyId",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("bad-credentials");
  });

  it("classifies SignatureDoesNotMatch as bad-credentials with no HTTP status", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "headBucket",
      errorName: "SignatureDoesNotMatch",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("bad-credentials");
  });

  it("classifies a network timeout as network", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "headBucket",
      errorName: "TimeoutError",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("network");
  });

  it("falls back to unknown for an unrecognized HTTP status", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "listObjects",
      httpStatusCode: 500,
      errorName: "InternalError",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("unknown");
  });

  it("classifies PermanentRedirect as a region mismatch", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "headBucket",
      httpStatusCode: 301,
      errorName: "PermanentRedirect",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("region-mismatch");
    expect(outcome.guidance).toMatch(/not in the region/);
  });

  it("classifies AuthorizationHeaderMalformed as a region mismatch", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "listObjects",
      httpStatusCode: 400,
      errorName: "AuthorizationHeaderMalformed",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.category).toBe("region-mismatch");
  });

  it("always appends the raw diagnostic detail to the guidance", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "listObjects",
      httpStatusCode: 500,
      errorName: "InternalError",
      message: "Something went wrong upstream",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.guidance).toMatch(/Details: listObjects step, InternalError, HTTP 500 — Something went wrong upstream/);
  });

  it("notes when there was no HTTP response at all in the diagnostic detail", () => {
    const probe: ConnectionProbeResult = {
      ok: false,
      step: "headBucket",
      message: "Failed to fetch",
    };
    const outcome = classifyConnectionFailure(probe);
    expect(outcome.guidance).toMatch(/\(no HTTP response\)/);
  });
});
