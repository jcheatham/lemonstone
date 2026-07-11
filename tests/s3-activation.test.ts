import { describe, it, expect } from "vitest";
import { isActivatedS3Card, type ActivatedS3Card } from "../src/s3/activation.ts";

function makeCard(overrides: Partial<ActivatedS3Card> = {}): ActivatedS3Card {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    displayName: "my-bucket",
    bucket: "my-bucket",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    activatedAt: 1730000000000,
    ...overrides,
  };
}

describe("isActivatedS3Card", () => {
  it("accepts a well-formed card", () => {
    expect(isActivatedS3Card(makeCard())).toBe(true);
  });

  it("accepts a card with a session token", () => {
    expect(isActivatedS3Card(makeCard({ sessionToken: "sts" }))).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { id: _id, ...withoutId } = makeCard();
    expect(isActivatedS3Card(withoutId)).toBe(false);
  });

  it("rejects a non-string sessionToken", () => {
    expect(isActivatedS3Card({ ...makeCard(), sessionToken: 123 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isActivatedS3Card(null)).toBe(false);
    expect(isActivatedS3Card("string")).toBe(false);
  });
});
