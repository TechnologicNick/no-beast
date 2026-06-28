import sharp from "sharp";
import { normalizeImage, normalizedSha256, rawSha256 } from "./image-hash.js";
import type { DatasetFingerprint } from "./types.js";

export async function createTestImage(color: { r: number; g: number; b: number }, width = 48, height = 48): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

export async function createDatasetFingerprint(
  id: string,
  relativePath: string,
  image: Uint8Array,
): Promise<DatasetFingerprint> {
  const normalized = await normalizeImage(image);
  return {
    id,
    relativePath,
    rawSha256: rawSha256(image),
    normalizedSha256: normalizedSha256(normalized.normalizedBytes),
    aspectRatio: normalized.aspectRatio,
    pHash: normalized.pHash,
    dHash: normalized.dHash,
    templateVector: normalized.templateVector,
  };
}
