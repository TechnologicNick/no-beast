import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import {
  ARCHETYPE_ASPECT_RATIO_SPLIT,
  BORDERLINE_SCORE_MARGIN,
  GLOBAL_SCORE_MARGIN,
  MAX_ASPECT_RATIO_DELTA,
  MAX_DHASH_DISTANCE,
  MAX_EDGEHASH_DISTANCE,
  MAX_GLOBAL_SCORE,
  MAX_LUMA_MAE,
  MAX_MEMBER_SCORE,
  MAX_PHASH_DISTANCE,
  MEMBER_SCORE_MARGIN,
  ROI_COUNT,
  ROI_MAE_MARGIN,
  ROI_WINDOW_SIZE,
  SUPPORTED_IMAGE_EXTENSIONS,
} from "./constants.js";
import {
  averageUint8Arrays,
  extractRoiSignature,
  hammingDistance,
  majorityHash,
  meanAbsoluteError,
  normalizeImage,
  rawSha256,
} from "./image-hash.js";
import type { Archetype, DatasetFingerprint, RoiWindow, ScamDataset, ScamFamilyModel } from "./types.js";

interface PendingFingerprint {
  id: string;
  relativePath: string;
  familyId: string;
  archetype: Archetype;
  rawSha256: string;
  aspectRatio: number;
  pHash: bigint;
  dHash: bigint;
  edgeHash: bigint;
  lumaGrid: Uint8Array;
  grayscale256: Uint8Array;
}

function getFirstSegment(value: string, separator: string): string | undefined {
  const [first] = value.split(separator);
  return first;
}

function parseFamilyKey(key: string): { familyId: string; archetype: Archetype } | null {
  const [familyId, archetypeValue] = key.split(":");
  if (!familyId || (archetypeValue !== "x-post" && archetypeValue !== "withdrawal-proof")) {
    return null;
  }
  return { familyId, archetype: archetypeValue };
}

function walk(dir: string, output: string[], excludedDirectoryNames: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, output, excludedDirectoryNames);
      continue;
    }
    if (SUPPORTED_IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      output.push(fullPath);
    }
  }
}

function detectArchetype(aspectRatio: number): Archetype {
  return aspectRatio < ARCHETYPE_ASPECT_RATIO_SPLIT ? "x-post" : "withdrawal-proof";
}

function listCandidateWindows(): RoiWindow[] {
  const windows: RoiWindow[] = [];
  for (let y = 0; y < 256; y += ROI_WINDOW_SIZE) {
    for (let x = 0; x < 256; x += ROI_WINDOW_SIZE) {
      windows.push({ x, y, size: ROI_WINDOW_SIZE });
    }
  }
  return windows;
}

function averageDistance(left: Uint8Array, right: Uint8Array): number {
  return meanAbsoluteError(left, right);
}

function selectRoiWindows(entries: PendingFingerprint[]): RoiWindow[] {
  const candidates = listCandidateWindows();
  if (entries.length === 0) {
    return candidates.slice(0, ROI_COUNT);
  }

  const scored = candidates.map((window) => {
    const byFamily = new Map<string, Uint8Array[]>();
    for (const entry of entries) {
      const signature = extractRoiSignature(entry.grayscale256, window);
      const familyEntries = byFamily.get(entry.familyId) ?? [];
      familyEntries.push(signature);
      byFamily.set(entry.familyId, familyEntries);
    }

    const centroids = new Map<string, Uint8Array>();
    let withinFamily = 0;
    let withinCount = 0;
    for (const [familyId, signatures] of byFamily) {
      const centroid = averageUint8Arrays(signatures);
      centroids.set(familyId, centroid);
      for (const signature of signatures) {
        withinFamily += averageDistance(signature, centroid);
        withinCount += 1;
      }
    }

    let betweenFamily = 0;
    let betweenCount = 0;
    const centroidEntries = Array.from(centroids.entries());
    for (let index = 0; index < centroidEntries.length; index += 1) {
      for (let other = index + 1; other < centroidEntries.length; other += 1) {
        const left = centroidEntries[index];
        const right = centroidEntries[other];
        if (!left || !right) {
          continue;
        }
        betweenFamily += averageDistance(left[1], right[1]);
        betweenCount += 1;
      }
    }

    const withinScore = withinCount === 0 ? 0 : withinFamily / withinCount;
    const betweenScore = betweenCount === 0 ? 0 : betweenFamily / betweenCount;
    return {
      window,
      score: betweenScore - withinScore,
    };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, ROI_COUNT).map(({ window }) => window);
}

function buildMatchScore(
  aspectRatioDelta: number,
  pHashDistance: number,
  dHashDistance: number,
  edgeHashDistance: number,
  lumaMae: number,
): number {
  return lumaMae + pHashDistance * 0.35 + dHashDistance * 0.25 + edgeHashDistance * 0.35 + aspectRatioDelta * 40;
}

function buildFamilyModels(fingerprints: DatasetFingerprint[], roiWindowsByArchetype: Record<Archetype, RoiWindow[]>): ScamFamilyModel[] {
  const grouped = new Map<string, DatasetFingerprint[]>();
  for (const fingerprint of fingerprints) {
    const key = `${fingerprint.familyId}:${fingerprint.archetype}`;
    const entries = grouped.get(key) ?? [];
    entries.push(fingerprint);
    grouped.set(key, entries);
  }

  const familyModels: ScamFamilyModel[] = [];
  for (const [key, members] of grouped) {
    const parsedKey = parseFamilyKey(key);
    if (!parsedKey) {
      continue;
    }
    const { familyId, archetype } = parsedKey;
    const roiWindows = roiWindowsByArchetype[archetype];
    const centroidAspectRatio = members.reduce((sum, member) => sum + member.aspectRatio, 0) / members.length;
    const centroidPHash = majorityHash(members.map((member) => member.pHash));
    const centroidDHash = majorityHash(members.map((member) => member.dHash));
    const centroidEdgeHash = majorityHash(members.map((member) => member.edgeHash));
    const centroidLumaGrid = averageUint8Arrays(members.map((member) => member.lumaGrid));
    const centroidRoiSignatures = roiWindows.map((_, index) =>
      averageUint8Arrays(members.map((member) => member.roiSignatures[index] ?? new Uint8Array())),
    );

    const aspectRatioDeltas = members.map((member) =>
      Math.abs(member.aspectRatio - centroidAspectRatio) / Math.max(member.aspectRatio, centroidAspectRatio),
    );
    const pHashDistances = members.map((member) => hammingDistance(member.pHash, centroidPHash));
    const dHashDistances = members.map((member) => hammingDistance(member.dHash, centroidDHash));
    const edgeHashDistances = members.map((member) => hammingDistance(member.edgeHash, centroidEdgeHash));
    const lumaMaes = members.map((member) => meanAbsoluteError(member.lumaGrid, centroidLumaGrid));
    const roiMaes = roiWindows.map((_, index) =>
      Math.max(
        ...members.map((member) =>
          meanAbsoluteError(member.roiSignatures[index] ?? new Uint8Array(), centroidRoiSignatures[index] ?? new Uint8Array()),
        ),
      ),
    );
    const memberScores = members.map((member) =>
      buildMatchScore(
        Math.abs(member.aspectRatio - centroidAspectRatio) / Math.max(member.aspectRatio, centroidAspectRatio),
        hammingDistance(member.pHash, centroidPHash),
        hammingDistance(member.dHash, centroidDHash),
        hammingDistance(member.edgeHash, centroidEdgeHash),
        meanAbsoluteError(member.lumaGrid, centroidLumaGrid),
      ),
    );

    familyModels.push({
      familyId,
      archetype,
      memberIds: members.map((member) => member.id),
      roiWindows,
      centroidAspectRatio,
      centroidPHash,
      centroidDHash,
      centroidEdgeHash,
      centroidLumaGrid,
      centroidRoiSignatures,
      thresholds: {
        globalScore: Math.min(MAX_GLOBAL_SCORE, Math.max(...memberScores) + GLOBAL_SCORE_MARGIN),
        borderlineScore: Math.min(MAX_GLOBAL_SCORE + BORDERLINE_SCORE_MARGIN, Math.max(...memberScores) + BORDERLINE_SCORE_MARGIN),
        memberScore: Math.min(MAX_MEMBER_SCORE, Math.max(...memberScores) + MEMBER_SCORE_MARGIN),
        aspectRatioDelta: Math.min(MAX_ASPECT_RATIO_DELTA, Math.max(...aspectRatioDeltas) + 0.04),
        pHashDistance: Math.min(MAX_PHASH_DISTANCE, Math.max(...pHashDistances) + 3),
        dHashDistance: Math.min(MAX_DHASH_DISTANCE, Math.max(...dHashDistances) + 3),
        edgeHashDistance: Math.min(MAX_EDGEHASH_DISTANCE, Math.max(...edgeHashDistances) + 3),
        lumaMae: Math.min(MAX_LUMA_MAE, Math.max(...lumaMaes) + 6),
        roiMae: roiMaes.map((value) => value + ROI_MAE_MARGIN),
        borderlineOnly: members.length < 2,
      },
    });
  }

  return familyModels;
}

export async function loadScamDataset(
  datasetRoot: string,
  options?: {
    excludedDirectoryNames?: Iterable<string>;
  },
): Promise<ScamDataset> {
  const root = resolve(datasetRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Dataset root is not a directory: ${datasetRoot}`);
  }

  const files: string[] = [];
  walk(root, files, new Set(options?.excludedDirectoryNames ?? []));

  const pending: PendingFingerprint[] = [];
  for (const file of files.sort()) {
    const bytes = readFileSync(file);
    const relativePath = relative(root, file).replaceAll("\\", "/");
    const normalized = await normalizeImage(bytes);
    pending.push({
      id: relativePath,
      relativePath,
      familyId: getFirstSegment(relativePath, "/") ?? relativePath,
      archetype: detectArchetype(normalized.aspectRatio),
      rawSha256: rawSha256(bytes),
      aspectRatio: normalized.aspectRatio,
      pHash: normalized.pHash,
      dHash: normalized.dHash,
      edgeHash: normalized.edgeHash,
      lumaGrid: normalized.lumaGrid,
      grayscale256: normalized.grayscale256,
    });
  }

  const roiWindowsByArchetype: Record<Archetype, RoiWindow[]> = {
    "x-post": selectRoiWindows(pending.filter((entry) => entry.archetype === "x-post")),
    "withdrawal-proof": selectRoiWindows(pending.filter((entry) => entry.archetype === "withdrawal-proof")),
  };

  const fingerprints: DatasetFingerprint[] = pending.map((entry) => ({
    id: entry.id,
    relativePath: entry.relativePath,
    familyId: entry.familyId,
    archetype: entry.archetype,
    rawSha256: entry.rawSha256,
    aspectRatio: entry.aspectRatio,
    pHash: entry.pHash,
    dHash: entry.dHash,
    edgeHash: entry.edgeHash,
    lumaGrid: entry.lumaGrid,
    roiSignatures: roiWindowsByArchetype[entry.archetype].map((window) => extractRoiSignature(entry.grayscale256, window)),
  }));

  return {
    fingerprints,
    familyModels: buildFamilyModels(fingerprints, roiWindowsByArchetype),
    roiWindowsByArchetype,
  };
}

export async function loadDatasetFingerprints(
  datasetRoot: string,
  options?: {
    excludedDirectoryNames?: Iterable<string>;
  },
): Promise<DatasetFingerprint[]> {
  return (await loadScamDataset(datasetRoot, options)).fingerprints;
}
