import { createHash } from "node:crypto";
import sharp from "sharp";
import type { NormalizedImageData } from "./types.js";

function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dct2d(input: number[], size: number): number[] {
  const result = new Array(size * size).fill(0);
  for (let u = 0; u < size; u += 1) {
    for (let v = 0; v < size; v += 1) {
      let sum = 0;
      for (let i = 0; i < size; i += 1) {
        for (let j = 0; j < size; j += 1) {
          const pixel = input[i * size + j] ?? 0;
          sum +=
            pixel *
            Math.cos(((2 * i + 1) * u * Math.PI) / (2 * size)) *
            Math.cos(((2 * j + 1) * v * Math.PI) / (2 * size));
        }
      }
      const alphaU = u === 0 ? Math.sqrt(1 / size) : Math.sqrt(2 / size);
      const alphaV = v === 0 ? Math.sqrt(1 / size) : Math.sqrt(2 / size);
      result[u * size + v] = alphaU * alphaV * sum;
    }
  }
  return result;
}

function computePHash(gray: number[]): bigint {
  const dct = dct2d(gray, 32);
  const lowFrequencies: number[] = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (x === 0 && y === 0) {
        continue;
      }
      lowFrequencies.push(dct[y * 32 + x] ?? 0);
    }
  }

  const avg = average(lowFrequencies);
  let hash = 0n;
  for (let index = 0; index < 64; index += 1) {
    const value = index === 0 ? dct[0] ?? 0 : lowFrequencies[index - 1] ?? 0;
    if (value >= avg) {
      hash |= 1n << BigInt(index);
    }
  }
  return hash;
}

function computeDHash(gray: number[]): bigint {
  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = gray[y * 9 + x] ?? 0;
      const right = gray[y * 9 + x + 1] ?? 0;
      if (left <= right) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }
  return hash;
}

export function hammingDistance(left: bigint, right: bigint): number {
  let value = left ^ right;
  let count = 0;
  while (value > 0n) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

export function rawSha256(buffer: Uint8Array): string {
  return sha256(buffer);
}

export function normalizedSha256(buffer: Uint8Array): string {
  return sha256(buffer);
}

export async function normalizeImage(buffer: Uint8Array): Promise<NormalizedImageData> {
  const rotated = sharp(buffer, { failOn: "none" }).rotate();
  const metadata = await rotated.metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;

  const normalizedBytes = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const pHashPixels = await sharp(normalizedBytes).grayscale().resize(32, 32).raw().toBuffer();
  const dHashPixels = await sharp(normalizedBytes).grayscale().resize(9, 8).raw().toBuffer();
  const templatePixels = await sharp(normalizedBytes).grayscale().resize(64, 64).raw().toBuffer();

  return {
    normalizedBytes,
    aspectRatio: width / height,
    pHash: computePHash(Array.from(pHashPixels.values())),
    dHash: computeDHash(Array.from(dHashPixels.values())),
    templateVector: new Uint8Array(templatePixels),
  };
}
