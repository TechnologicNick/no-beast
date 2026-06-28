import sharp from "sharp";
import { extractRoiSignature, normalizeImage, rawSha256 } from "./image-hash.js";
import type { Archetype, DatasetFingerprint, RoiWindow } from "./types.js";

function getFamilyIdFromPath(relativePath: string): string {
  const [, familyId] = relativePath.split("/");
  return familyId ?? "family";
}

function detectArchetype(aspectRatio: number): Archetype {
  return aspectRatio < 0.9 ? "x-post" : "withdrawal-proof";
}

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
  options?: {
    familyId?: string;
    roiWindows?: RoiWindow[];
  },
): Promise<DatasetFingerprint> {
  const normalized = await normalizeImage(image);
  const archetype = detectArchetype(normalized.aspectRatio);
  const roiWindows = options?.roiWindows ?? [
    { x: 0, y: 0, size: 64 },
    { x: 64, y: 0, size: 64 },
    { x: 0, y: 64, size: 64 },
    { x: 64, y: 64, size: 64 },
  ];

  return {
    id,
    relativePath,
    familyId: options?.familyId ?? getFamilyIdFromPath(relativePath),
    archetype,
    rawSha256: rawSha256(image),
    aspectRatio: normalized.aspectRatio,
    pHash: normalized.pHash,
    dHash: normalized.dHash,
    edgeHash: normalized.edgeHash,
    lumaGrid: normalized.lumaGrid,
    roiSignatures: roiWindows.map((window) => extractRoiSignature(normalized.grayscale256, window)),
  };
}
