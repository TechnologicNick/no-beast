import { createHash } from "node:crypto";
import sharp from "sharp";
import { LUMA_GRID_SIZE, NORMALIZED_IMAGE_SIZE, ROI_GRID_SIZE } from "./constants.js";
import type { NormalizedImageData, RoiWindow } from "./types.js";

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

function computeEdgePixels(gray: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const left = gray[y * width + (x - 1)] ?? 0;
      const right = gray[y * width + (x + 1)] ?? 0;
      const up = gray[(y - 1) * width + x] ?? 0;
      const down = gray[(y + 1) * width + x] ?? 0;
      output[y * width + x] = Math.min(255, Math.abs(left - right) + Math.abs(up - down));
    }
  }
  return output;
}

function computeBlockMeans(pixels: Uint8Array, width: number, height: number, gridSize: number): Uint8Array {
  const blockWidth = width / gridSize;
  const blockHeight = height / gridSize;
  const result = new Uint8Array(gridSize * gridSize);
  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      let total = 0;
      let count = 0;
      const startX = Math.floor(gridX * blockWidth);
      const endX = Math.floor((gridX + 1) * blockWidth);
      const startY = Math.floor(gridY * blockHeight);
      const endY = Math.floor((gridY + 1) * blockHeight);
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          total += pixels[y * width + x] ?? 0;
          count += 1;
        }
      }
      result[gridY * gridSize + gridX] = Math.round(total / Math.max(1, count));
    }
  }
  return result;
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

export function meanAbsoluteError(left: Uint8Array, right: Uint8Array): number {
  const length = Math.max(left.length, right.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return total / Math.max(1, length);
}

export function averageUint8Arrays(values: Uint8Array[]): Uint8Array {
  if (values.length === 0) {
    return new Uint8Array();
  }
  const first = values[0];
  if (!first) {
    return new Uint8Array();
  }
  const length = first.length;
  const totals = new Array<number>(length).fill(0);
  for (const value of values) {
    for (let index = 0; index < length; index += 1) {
      totals[index] = (totals[index] ?? 0) + (value[index] ?? 0);
    }
  }
  return Uint8Array.from(totals.map((total) => Math.round(total / values.length)));
}

export function majorityHash(values: bigint[]): bigint {
  if (values.length === 0) {
    return 0n;
  }
  let hash = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    let ones = 0;
    for (const value of values) {
      ones += Number((value >> BigInt(bit)) & 1n);
    }
    if (ones * 2 >= values.length) {
      hash |= 1n << BigInt(bit);
    }
  }
  return hash;
}

export function extractRoiSignature(grayscale256: Uint8Array, window: RoiWindow): Uint8Array {
  const roi = new Uint8Array(window.size * window.size);
  for (let y = 0; y < window.size; y += 1) {
    for (let x = 0; x < window.size; x += 1) {
      const sourceIndex = (window.y + y) * NORMALIZED_IMAGE_SIZE + (window.x + x);
      roi[y * window.size + x] = grayscale256[sourceIndex] ?? 0;
    }
  }
  return computeBlockMeans(roi, window.size, window.size, ROI_GRID_SIZE);
}

export async function normalizeImage(buffer: Uint8Array): Promise<NormalizedImageData> {
  const rotated = sharp(buffer, { failOn: "none", animated: true, page: 0, pages: 1 }).rotate();
  const metadata = await rotated.metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;

  const normalizedBytes = await rotated
    .clone()
    .resize(NORMALIZED_IMAGE_SIZE, NORMALIZED_IMAGE_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .grayscale()
    .png()
    .toBuffer();

  const grayscaleBuffer = await sharp(normalizedBytes).raw().toBuffer();
  const grayscale256 = new Uint8Array(grayscaleBuffer);
  const edgePixels = computeEdgePixels(grayscale256, NORMALIZED_IMAGE_SIZE, NORMALIZED_IMAGE_SIZE);

  const pHashPixels = await sharp(grayscaleBuffer, {
    raw: { width: NORMALIZED_IMAGE_SIZE, height: NORMALIZED_IMAGE_SIZE, channels: 1 },
  })
    .resize(32, 32)
    .raw()
    .toBuffer();
  const dHashPixels = await sharp(grayscaleBuffer, {
    raw: { width: NORMALIZED_IMAGE_SIZE, height: NORMALIZED_IMAGE_SIZE, channels: 1 },
  })
    .resize(9, 8)
    .raw()
    .toBuffer();
  const edgeHashPixels = await sharp(Buffer.from(edgePixels), {
    raw: { width: NORMALIZED_IMAGE_SIZE, height: NORMALIZED_IMAGE_SIZE, channels: 1 },
  })
    .resize(32, 32)
    .raw()
    .toBuffer();

  return {
    normalizedBytes,
    grayscale256,
    aspectRatio: width / height,
    pHash: computePHash(Array.from(pHashPixels.values())),
    dHash: computeDHash(Array.from(dHashPixels.values())),
    edgeHash: computePHash(Array.from(edgeHashPixels.values())),
    lumaGrid: computeBlockMeans(grayscale256, NORMALIZED_IMAGE_SIZE, NORMALIZED_IMAGE_SIZE, LUMA_GRID_SIZE),
  };
}
