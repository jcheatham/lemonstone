// Connection test run before a card's credential is ever sealed into an
// s3vault blob — a raw browser CORS failure (no HTTP status at all)
// is an opaque dead-end with no backend to help debug it, so this maps the
// probe's outcome to actionable guidance instead.
//
// The actual network probe (HeadBucket, then ListObjectsV2) runs inside the
// S3 worker against a transient client built from the not-yet-saved
// credentials (see s3-session.ts `testConnection` / s3-worker.ts's
// "testConnection" op) — this module only classifies the result.

import { testS3Connection } from "./s3-client.ts";
import type { S3Credential } from "./credential.ts";
import type { ConnectionProbeResult } from "./s3-session.ts";

export type ConnectionFailureCategory =
  | "cors-or-region"
  | "forbidden"
  | "not-found"
  | "bad-credentials"
  | "region-mismatch"
  | "network"
  | "unknown";

export interface ConnectionTestOutcome {
  ok: boolean;
  category?: ConnectionFailureCategory;
  guidance?: string;
  raw?: ConnectionProbeResult;
}

const BAD_CREDENTIAL_CODES = new Set(["InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidClientTokenId"]);
const NETWORK_TIMEOUT_CODES = new Set(["TimeoutError", "NetworkingError", "ECONNABORTED"]);
// S3 returns these when the request was signed for the wrong regional
// endpoint (bucket exists, but not in the region given) — a very common
// real-world gotcha distinct from a bad bucket name or bad credentials.
const REGION_MISMATCH_CODES = new Set(["PermanentRedirect", "AuthorizationHeaderMalformed", "IllegalLocationConstraintException"]);

const GUIDANCE: Record<ConnectionFailureCategory, string> = {
  "cors-or-region":
    "Couldn't reach the bucket at all (no HTTP response). This usually means either the bucket's CORS " +
    "policy doesn't allow this app's origin, or the region is wrong (a request signed for the wrong " +
    "regional endpoint gets rejected before CORS even applies). Check the bucket's CORS configuration and " +
    "confirm the region matches the bucket's actual region.",
  forbidden:
    "Credentials were accepted, but access was denied. Check that the attached IAM policy grants " +
    "s3:ListBucket / s3:GetObject / s3:PutObject / s3:DeleteObject on this exact bucket ARN.",
  "not-found": "No such bucket in that region — check the bucket name and region are both correct.",
  "bad-credentials": "The access key or secret key is incorrect, or the key has been deactivated or rotated.",
  "region-mismatch": "The bucket exists, but not in the region you entered. Check the bucket's actual region (see its properties in the AWS console) and correct it here.",
  network:
    "Couldn't reach AWS at all. Check your network connectivity — if you're behind a restrictive " +
    "network or VPN, *.amazonaws.com may be blocked.",
  unknown: "The connection test failed for an unrecognized reason.",
};

/** Pure classification — feed it a probe result directly, no network involved. */
export function classifyConnectionFailure(probe: ConnectionProbeResult): ConnectionTestOutcome {
  if (probe.ok) return { ok: true, raw: probe };

  const category = categorize(probe);
  // Always append the raw diagnostic (step, error code, HTTP status) so a
  // failure that doesn't fit a known bucket cleanly still hands the user
  // something concrete to search/report, instead of a dead-end sentence.
  const guidance = `${GUIDANCE[category]}\n\nDetails: ${probe.step ?? "?"} step, ${probe.errorName ?? "no error code"}${
    probe.httpStatusCode !== undefined ? `, HTTP ${probe.httpStatusCode}` : " (no HTTP response)"
  } — ${probe.message ?? "no message"}`;
  return { ok: false, category, guidance, raw: probe };
}

function categorize(probe: ConnectionProbeResult): ConnectionFailureCategory {
  // A bare fetch-level failure surfaces with no HTTP status at all — that's
  // the CORS/wrong-region signature. Bare-fetch TypeErrors carry no $metadata.
  if (probe.httpStatusCode === undefined) {
    if (probe.errorName && NETWORK_TIMEOUT_CODES.has(probe.errorName)) return "network";
    if (probe.errorName && BAD_CREDENTIAL_CODES.has(probe.errorName)) return "bad-credentials";
    return "cors-or-region";
  }
  if (probe.errorName && BAD_CREDENTIAL_CODES.has(probe.errorName)) return "bad-credentials";
  if (probe.errorName && REGION_MISMATCH_CODES.has(probe.errorName)) return "region-mismatch";
  if (probe.httpStatusCode === 403) return "forbidden";
  if (probe.httpStatusCode === 404 && probe.step === "headBucket") return "not-found";
  return "unknown";
}

/** Run the probe against not-yet-persisted credentials and classify the result. */
export async function runConnectionTest(
  bucket: string,
  region: string,
  credential: S3Credential,
  endpoint?: string
): Promise<ConnectionTestOutcome> {
  const result = await testS3Connection(bucket, region, credential, endpoint);
  const probe = result["probe"] as ConnectionProbeResult;
  return classifyConnectionFailure(probe);
}
