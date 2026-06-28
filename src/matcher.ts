import {
  ASPECT_RATIO_DELTA_THRESHOLD,
  DHASH_DISTANCE_THRESHOLD,
  MIN_NEAR_DUPLICATE_MATCHES,
  PHASH_DISTANCE_THRESHOLD,
  TEMPLATE_MAE_THRESHOLD,
} from "./constants.js";
import { hammingDistance, normalizeImage, normalizedSha256, rawSha256 } from "./image-hash.js";
import type { AttachmentMatchResult, DatasetFingerprint, MatchDetail } from "./types.js";

function templateMae(left: Uint8Array, right: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return total / left.length;
}

export class AttachmentMatcher {
  private readonly dataset: DatasetFingerprint[];
  private readonly byRawSha = new Map<string, DatasetFingerprint[]>();
  private readonly byNormalizedSha = new Map<string, DatasetFingerprint[]>();

  public constructor(dataset: DatasetFingerprint[]) {
    this.dataset = dataset;
    for (const entry of dataset) {
      const rawMatches = this.byRawSha.get(entry.rawSha256) ?? [];
      rawMatches.push(entry);
      this.byRawSha.set(entry.rawSha256, rawMatches);

      const normalizedMatches = this.byNormalizedSha.get(entry.normalizedSha256) ?? [];
      normalizedMatches.push(entry);
      this.byNormalizedSha.set(entry.normalizedSha256, normalizedMatches);
    }
  }

  public async matchBuffer(buffer: Uint8Array): Promise<AttachmentMatchResult> {
    const rawHash = rawSha256(buffer);
    const rawMatches = this.byRawSha.get(rawHash);
    const exactRawDetails = (rawMatches ?? []).map((reference) => ({
      reference,
      stage: "exact-raw" as const,
      aspectRatioDelta: 0,
      pHashDistance: 0,
      dHashDistance: 0,
      templateMae: 0,
    }));

    const normalized = await normalizeImage(buffer);
    const normalizedHash = normalizedSha256(normalized.normalizedBytes);
    const normalizedMatches = this.byNormalizedSha.get(normalizedHash);
    const exactNormalizedDetails = (normalizedMatches ?? []).map((reference) => ({
      reference,
      stage: "exact-normalized" as const,
      aspectRatioDelta: Math.abs(reference.aspectRatio - normalized.aspectRatio),
      pHashDistance: hammingDistance(reference.pHash, normalized.pHash),
      dHashDistance: hammingDistance(reference.dHash, normalized.dHash),
      templateMae: templateMae(reference.templateVector, normalized.templateVector),
    }));

    const nearMatches: MatchDetail[] = [];
    const templateMatches: MatchDetail[] = [];
    for (const reference of this.dataset) {
      const aspectRatioDelta =
        Math.abs(reference.aspectRatio - normalized.aspectRatio) /
        Math.max(reference.aspectRatio, normalized.aspectRatio);
      const pHashDistance = hammingDistance(reference.pHash, normalized.pHash);
      const dHashDistance = hammingDistance(reference.dHash, normalized.dHash);
      const mae = templateMae(reference.templateVector, normalized.templateVector);

      if (
        aspectRatioDelta <= ASPECT_RATIO_DELTA_THRESHOLD &&
        pHashDistance <= PHASH_DISTANCE_THRESHOLD &&
        dHashDistance <= DHASH_DISTANCE_THRESHOLD
      ) {
        nearMatches.push({
          reference,
          stage: "near-duplicate",
          aspectRatioDelta,
          pHashDistance,
          dHashDistance,
          templateMae: mae,
        });
      }

      if (mae <= TEMPLATE_MAE_THRESHOLD) {
        templateMatches.push({
          reference,
          stage: "template-nearest",
          aspectRatioDelta,
          pHashDistance,
          dHashDistance,
          templateMae: mae,
        });
      }
    }

    nearMatches.sort((left, right) => {
      const leftScore = left.pHashDistance + left.dHashDistance + left.aspectRatioDelta;
      const rightScore = right.pHashDistance + right.dHashDistance + right.aspectRatioDelta;
      return leftScore - rightScore;
    });
    templateMatches.sort((left, right) => left.templateMae - right.templateMae);

    if (exactRawDetails.length > 0) {
      return {
        matched: true,
        stage: "exact-raw",
        details: exactRawDetails,
        rawMatches: exactRawDetails,
        normalizedMatches: exactNormalizedDetails,
        nearDuplicateCandidates: nearMatches,
        templateNearestCandidates: templateMatches,
      };
    }

    if (exactNormalizedDetails.length > 0) {
      return {
        matched: true,
        stage: "exact-normalized",
        details: exactNormalizedDetails,
        rawMatches: [],
        normalizedMatches: exactNormalizedDetails,
        nearDuplicateCandidates: nearMatches,
        templateNearestCandidates: templateMatches,
      };
    }

    if (nearMatches.length >= MIN_NEAR_DUPLICATE_MATCHES) {
      return {
        matched: true,
        stage: "near-duplicate",
        details: nearMatches,
        rawMatches: [],
        normalizedMatches: [],
        nearDuplicateCandidates: nearMatches,
        templateNearestCandidates: templateMatches,
      };
    }

    if (templateMatches.length > 0) {
      return {
        matched: true,
        stage: "template-nearest",
        details: templateMatches,
        rawMatches: [],
        normalizedMatches: [],
        nearDuplicateCandidates: nearMatches,
        templateNearestCandidates: templateMatches,
      };
    }

    return {
      matched: false,
      rawMatches: exactRawDetails,
      normalizedMatches: exactNormalizedDetails,
      nearDuplicateCandidates: nearMatches,
      templateNearestCandidates: templateMatches,
    };
  }
}
