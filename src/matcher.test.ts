import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { loadDatasetFingerprints } from "./dataset.js";
import { AttachmentMatcher } from "./matcher.js";
import { createDatasetFingerprint, createTestImage } from "./test-helpers.js";

async function loadAllowedFixtureBuffer(path: string): Promise<Uint8Array> {
  const bytes = readFileSync(path);
  if (extname(path).toLowerCase() !== ".gif") {
    return bytes;
  }

  return await sharp(bytes, { animated: true, page: 0, pages: 1 }).png().toBuffer();
}

function listFixtureFiles(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .filter((entry) => typeof entry === "string")
    .filter((name) => !name.startsWith("."))
    .map((name) => join(root, name))
    .filter((path) => statSync(path).isFile());
}

describe("AttachmentMatcher", () => {
  test("matches an exact dataset image", async () => {
    const image = await createTestImage({ r: 255, g: 0, b: 0 });
    const entry = await createDatasetFingerprint("1", "scam/red.png", image);
    const matcher = new AttachmentMatcher([entry]);

    const result = await matcher.matchBuffer(image);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.stage).toBe("exact-raw");
    }
  });

  test("matches a re-encoded image as exact-normalized or near-duplicate", async () => {
    const original = await createTestImage({ r: 0, g: 255, b: 0 }, 64, 48);
    const reencoded = await sharp(original).jpeg({ quality: 85 }).toBuffer();
    const entryOne = await createDatasetFingerprint("1", "scam/green-a.png", original);
    const entryTwo = await createDatasetFingerprint("2", "scam/green-b.png", original);
    const matcher = new AttachmentMatcher([entryOne, entryTwo]);

    const result = await matcher.matchBuffer(reencoded);
    expect(result.matched).toBe(true);
  });

  test("does not match unrelated images", async () => {
    const red = await createTestImage({ r: 255, g: 0, b: 0 });
    const blue = await createTestImage({ r: 0, g: 0, b: 255 });
    const entry = await createDatasetFingerprint("1", "scam/red.png", red);
    const matcher = new AttachmentMatcher([entry]);

    const result = await matcher.matchBuffer(blue);
    expect(result.matched).toBe(false);
  });

  test("does not detect allowed dataset images as scams", async () => {
    const matcher = new AttachmentMatcher(await loadDatasetFingerprints("./datasets/scam"));
    const files = listFixtureFiles("./datasets/allowed");

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const image = await loadAllowedFixtureBuffer(file);
      const result = await matcher.matchBuffer(image);
      expect(result.matched, `expected ${file} not to match the scam dataset`).toBe(false);
    }
  });

  test("detects evaluate dataset images as scams", async () => {
    const matcher = new AttachmentMatcher(await loadDatasetFingerprints("./datasets/scam"));
    const files = listFixtureFiles("./datasets/evaluate");

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const image = await loadAllowedFixtureBuffer(file);
      const result = await matcher.matchBuffer(image);
      expect(result.matched, `expected ${file} to match the scam dataset`).toBe(true);
    }
  });
});
