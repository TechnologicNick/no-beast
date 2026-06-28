import { describe, expect, test } from "bun:test";
import { loadDatasetFingerprints } from "./dataset.js";

describe("loadDatasetFingerprints", () => {
  test("indexes the bundled dataset", async () => {
    const fingerprints = await loadDatasetFingerprints("./datasets/scam");
    expect(fingerprints.length).toBeGreaterThan(0);
    expect(fingerprints.every((entry) => entry.relativePath.length > 0)).toBe(true);
  });
});
