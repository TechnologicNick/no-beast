import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { loadScamDataset } from "./dataset.js";
import { AttachmentMatcher } from "./matcher.js";

async function loadFixtureBuffer(path: string): Promise<Uint8Array> {
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

async function createMatcher(): Promise<AttachmentMatcher> {
  return new AttachmentMatcher(await loadScamDataset("./datasets/scam"), { useWorkers: false });
}

describe("AttachmentMatcher", () => {
  test("matches an exact dataset image via raw SHA", async () => {
    const matcher = await createMatcher();
    const file = listFixtureFiles("./datasets/scam")[0];
    if (!file) {
      throw new Error("Expected at least one scam fixture");
    }
    const image = await loadFixtureBuffer(file);

    const result = await matcher.matchBuffer(image);
    expect(result.classification).toBe("scam");
    expect(result.stage).toBe("exact-raw");
  });

  test("classifies all scam dataset images as scams", async () => {
    const matcher = await createMatcher();
    const files = listFixtureFiles("./datasets/scam");

    for (const file of files) {
      const image = await loadFixtureBuffer(file);
      const result = await matcher.matchBuffer(image);
      expect(result.classification, `expected ${file} to classify as scam`).toBe("scam");
    }
  });

  test("classifies evaluate dataset images as scams", async () => {
    const matcher = await createMatcher();
    const files = listFixtureFiles("./datasets/evaluate");

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const image = await loadFixtureBuffer(file);
      const result = await matcher.matchBuffer(image);
      expect(result.classification, `expected ${file} to classify as scam`).toBe("scam");
    }
  });

  test("classifies allowed dataset images as safe", async () => {
    const matcher = await createMatcher();
    const files = listFixtureFiles("./datasets/allowed");

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const image = await loadFixtureBuffer(file);
      const result = await matcher.matchBuffer(image);
      expect(result.classification, `expected ${file} not to classify as scam`).toBe("safe");
    }
  });

  test("keeps real_darker.jpg safely below borderline", async () => {
    const matcher = await createMatcher();
    const image = await loadFixtureBuffer("./datasets/allowed/real_darker.jpg");

    const result = await matcher.matchBuffer(image);
    expect(result.classification).toBe("safe");
  });

  test("keeps a re-encoded, darkened, and lightly cropped scam variant classified as scam", async () => {
    const matcher = await createMatcher();
    const source = await loadFixtureBuffer("./datasets/scam/hesobia/1.jpg");
    const variant = await sharp(source)
      .extract({ left: 16, top: 12, width: 960, height: 1200 })
      .modulate({ brightness: 0.82 })
      .jpeg({ quality: 82 })
      .toBuffer();

    const result = await matcher.matchBuffer(variant);
    expect(result.classification).toBe("scam");
  });
});
