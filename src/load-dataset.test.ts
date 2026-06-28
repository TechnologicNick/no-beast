import { describe, expect, test } from "bun:test";
import { loadScamDataset } from "./dataset.js";

describe("loadScamDataset", () => {
  test("indexes the bundled dataset and produces family models", async () => {
    const dataset = await loadScamDataset("./datasets/scam");
    expect(dataset.fingerprints.length).toBeGreaterThan(0);
    expect(dataset.familyModels.length).toBeGreaterThan(0);
    expect(dataset.fingerprints.every((entry) => entry.relativePath.length > 0)).toBe(true);
    expect(dataset.fingerprints.every((entry) => entry.roiSignatures.length === 4)).toBe(true);
  });
});
