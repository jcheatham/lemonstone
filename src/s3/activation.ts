// Local (per-device, non-synced) record of S3 vault cards this device has
// activated — mirrors the snippet:connect-grants pattern (src/ui/ls-app.ts):
// stored via VaultService.getConfig/setConfig, a plain per-vault-DB IndexedDB
// "config" entry, never committed to the repo. The card blob itself (embedded
// in note content, see src/s3/card.ts) is the only synced/persistent record;
// this is just "which cards has THIS browser already decrypted and accepted."

export const ACTIVATED_S3_CARDS_CONFIG_KEY = "s3card:activated";

export interface ActivatedS3Card {
  id: string;
  displayName: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  activatedAt: number;
}

export type ActivatedS3Cards = Record<string, ActivatedS3Card>; // keyed by card id

export function isActivatedS3Card(value: unknown): value is ActivatedS3Card {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["displayName"] === "string" &&
    typeof v["bucket"] === "string" &&
    typeof v["region"] === "string" &&
    typeof v["accessKeyId"] === "string" &&
    typeof v["secretAccessKey"] === "string" &&
    (v["sessionToken"] === undefined || typeof v["sessionToken"] === "string") &&
    typeof v["activatedAt"] === "number"
  );
}
