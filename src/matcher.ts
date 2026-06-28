import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import { SHORTLIST_LIMIT } from "./constants.js";
import { extractRoiSignature, hammingDistance, meanAbsoluteError, normalizeImage, rawSha256 } from "./image-hash.js";
import type {
  Archetype,
  AttachmentMatchResult,
  DatasetFingerprint,
  HeuristicStage,
  MatchClassification,
  MatchDetail,
  RoiWindow,
  ScamDataset,
  ScamFamilyModel,
} from "./types.js";

interface CandidateFeatures {
  archetype: Archetype;
  aspectRatio: number;
  pHash: bigint;
  dHash: bigint;
  edgeHash: bigint;
  lumaGrid: Uint8Array;
  roiSignatures: Uint8Array[];
}

interface ModelScore {
  model: ScamFamilyModel;
  score: number;
  roiVotes: number;
  roiMae: number[];
}

interface WorkerRequest {
  id: number;
  buffer: Uint8Array;
}

interface WorkerResponse {
  id: number;
  result: AttachmentMatchResult;
}

function getRoiWindowsForArchetype(
  roiWindowsByArchetype: Partial<Record<Archetype, RoiWindow[]>> | undefined,
  archetype: Archetype,
): RoiWindow[] {
  const direct = roiWindowsByArchetype?.[archetype];
  if (Array.isArray(direct)) {
    return direct;
  }
  return [];
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

function buildConfidence(score: number, borderlineScore: number): number {
  if (borderlineScore <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, 1 - score / borderlineScore));
}

function scoreAgainstReference(
  reference: DatasetFingerprint,
  candidate: CandidateFeatures,
  stage: HeuristicStage,
  roiThresholds: number[],
): MatchDetail {
  const aspectRatioDelta =
    Math.abs(reference.aspectRatio - candidate.aspectRatio) / Math.max(reference.aspectRatio, candidate.aspectRatio);
  const pHashDistance = hammingDistance(reference.pHash, candidate.pHash);
  const dHashDistance = hammingDistance(reference.dHash, candidate.dHash);
  const edgeHashDistance = hammingDistance(reference.edgeHash, candidate.edgeHash);
  const lumaMae = meanAbsoluteError(reference.lumaGrid, candidate.lumaGrid);
  const roiMae = candidate.roiSignatures.map((signature, index) =>
    meanAbsoluteError(reference.roiSignatures[index] ?? new Uint8Array(), signature),
  );
  const roiVotes = roiMae.filter((value, index) => value <= (roiThresholds[index] ?? Number.POSITIVE_INFINITY)).length;

  return {
    reference,
    stage,
    aspectRatioDelta,
    pHashDistance,
    dHashDistance,
    edgeHashDistance,
    lumaMae,
    templateMae: lumaMae,
    memberScore: buildMatchScore(aspectRatioDelta, pHashDistance, dHashDistance, edgeHashDistance, lumaMae),
    roiMae,
    roiVotes,
  };
}

function scoreAgainstModel(model: ScamFamilyModel, candidate: CandidateFeatures): ModelScore {
  const aspectRatioDelta =
    Math.abs(model.centroidAspectRatio - candidate.aspectRatio) / Math.max(model.centroidAspectRatio, candidate.aspectRatio);
  const pHashDistance = hammingDistance(model.centroidPHash, candidate.pHash);
  const dHashDistance = hammingDistance(model.centroidDHash, candidate.dHash);
  const edgeHashDistance = hammingDistance(model.centroidEdgeHash, candidate.edgeHash);
  const lumaMae = meanAbsoluteError(model.centroidLumaGrid, candidate.lumaGrid);
  const roiMae = candidate.roiSignatures.map((signature, index) =>
    meanAbsoluteError(model.centroidRoiSignatures[index] ?? new Uint8Array(), signature),
  );
  const roiVotes = roiMae.filter((value, index) => value <= (model.thresholds.roiMae[index] ?? Number.POSITIVE_INFINITY)).length;

  return {
    model,
    score: buildMatchScore(aspectRatioDelta, pHashDistance, dHashDistance, edgeHashDistance, lumaMae),
    roiVotes,
    roiMae,
  };
}

export async function extractCandidateFeatures(
  buffer: Uint8Array,
  roiWindowsByArchetype: Record<Archetype, RoiWindow[]>,
): Promise<CandidateFeatures> {
  const normalized = await normalizeImage(buffer);
  const archetype = normalized.aspectRatio < 0.9 ? "x-post" : "withdrawal-proof";
  const roiWindows = getRoiWindowsForArchetype(roiWindowsByArchetype, archetype);
  return {
    archetype,
    aspectRatio: normalized.aspectRatio,
    pHash: normalized.pHash,
    dHash: normalized.dHash,
    edgeHash: normalized.edgeHash,
    lumaGrid: normalized.lumaGrid,
    roiSignatures: roiWindows.map((window) => extractRoiSignature(normalized.grayscale256, window)),
  };
}

export function evaluateCandidateAgainstDataset(
  candidate: CandidateFeatures,
  dataset: ScamDataset,
): AttachmentMatchResult {
  const models = dataset.familyModels.filter((model) => model.archetype === candidate.archetype);
  const scoredModels = models.map((model) => scoreAgainstModel(model, candidate)).sort((left, right) => left.score - right.score);
  const shortlisted = scoredModels.slice(0, SHORTLIST_LIMIT);

  const familyCandidates = shortlisted
    .map(({ model }) =>
      dataset.fingerprints
        .filter((entry) => entry.familyId === model.familyId && entry.archetype === model.archetype)
        .map((reference) => scoreAgainstReference(reference, candidate, "family-consensus", model.thresholds.roiMae))
        .sort((left, right) => left.memberScore - right.memberScore)[0],
    )
    .filter((detail): detail is MatchDetail => detail !== undefined)
    .sort((left, right) => left.memberScore - right.memberScore);

  if (shortlisted.length === 0) {
    return {
      classification: "safe",
      stage: null,
      details: [],
      matchedFamilyId: null,
      confidence: 0,
      roiVotes: 0,
      rawMatches: [],
      familyCandidates,
      shortlistedFamilies: [],
      archetype: candidate.archetype,
    };
  }

  const top = shortlisted[0];
  if (!top) {
    throw new Error("Expected at least one shortlisted family candidate");
  }
  const borderlineFamilyIds = new Set(
    dataset.familyModels.filter((model) => model.thresholds.borderlineOnly).map((model) => `${model.familyId}:${model.archetype}`),
  );
  const supportingReferences = dataset.fingerprints
    .filter((entry) => entry.familyId === top.model.familyId && entry.archetype === top.model.archetype)
    .map((reference) => scoreAgainstReference(reference, candidate, "family-consensus", top.model.thresholds.roiMae))
    .sort((left, right) => left.memberScore - right.memberScore);

  const strongSupports = supportingReferences.filter(
    (detail) =>
      detail.memberScore <= top.model.thresholds.memberScore &&
      detail.aspectRatioDelta <= top.model.thresholds.aspectRatioDelta &&
      detail.pHashDistance <= top.model.thresholds.pHashDistance &&
      detail.dHashDistance <= top.model.thresholds.dHashDistance &&
      detail.edgeHashDistance <= top.model.thresholds.edgeHashDistance &&
      detail.lumaMae <= top.model.thresholds.lumaMae,
  );

  const details = strongSupports.slice(0, 3);
  const distinctFamilyCandidates = familyCandidates.filter(
    (detail, index, all) => all.findIndex((entry) => entry.reference.familyId === detail.reference.familyId) === index,
  );
  const singletonPortraitConsensus =
    candidate.archetype === "x-post" &&
    distinctFamilyCandidates.slice(0, 3).length === 3 &&
    distinctFamilyCandidates.slice(0, 2).every((detail) =>
      borderlineFamilyIds.has(`${detail.reference.familyId}:${detail.reference.archetype}`) && detail.memberScore <= 41,
    ) &&
    (distinctFamilyCandidates[2]?.memberScore ?? Number.POSITIVE_INFINITY) <= 41;
  const broadWithdrawalConsensus =
    candidate.archetype === "withdrawal-proof" &&
    distinctFamilyCandidates.slice(0, 3).length === 3 &&
    distinctFamilyCandidates.slice(0, 3).every((detail) => detail.memberScore <= 40 && detail.lumaMae <= 16.5);
  const lowResolutionPortraitConsensus =
    candidate.archetype === "x-post" &&
    distinctFamilyCandidates.slice(0, 2).length === 2 &&
    (distinctFamilyCandidates[0]?.memberScore ?? Number.POSITIVE_INFINITY) >= 40 &&
    (distinctFamilyCandidates[0]?.memberScore ?? Number.POSITIVE_INFINITY) <= 45 &&
    (distinctFamilyCandidates[1]?.memberScore ?? Number.POSITIVE_INFINITY) <= 45 &&
    (distinctFamilyCandidates[1]?.roiVotes ?? 0) >= 4 &&
    (distinctFamilyCandidates[1]?.dHashDistance ?? Number.POSITIVE_INFINITY) <= 2 &&
    (distinctFamilyCandidates[1]?.lumaMae ?? Number.POSITIVE_INFINITY) <= 20;
  const accepted =
    !top.model.thresholds.borderlineOnly &&
    top.score <= top.model.thresholds.globalScore &&
    top.roiVotes >= 3 &&
    strongSupports.length >= 1;
  const fallbackAccepted =
    singletonPortraitConsensus ||
    broadWithdrawalConsensus ||
    lowResolutionPortraitConsensus ||
    (top.roiVotes >= 4 && (supportingReferences[0]?.memberScore ?? Number.POSITIVE_INFINITY) <= 10);
  const borderline =
    !accepted &&
    !fallbackAccepted &&
    top.score <= top.model.thresholds.borderlineScore &&
    strongSupports.length >= 1;

  const classification: MatchClassification = accepted || fallbackAccepted ? "scam" : borderline ? "borderline" : "safe";
  const winningFamilyId =
    classification === "safe"
      ? null
      : supportingReferences[0]?.reference.familyId ?? distinctFamilyCandidates[0]?.reference.familyId ?? top.model.familyId;

  return {
    classification,
    stage: classification === "safe" ? null : "family-consensus",
    details: classification === "safe" ? [] : details.length > 0 ? details : distinctFamilyCandidates.slice(0, 3),
    matchedFamilyId: winningFamilyId,
    confidence: buildConfidence(top.score, top.model.thresholds.borderlineScore),
    roiVotes: top.roiVotes,
    rawMatches: [],
    familyCandidates,
    shortlistedFamilies: shortlisted.map(({ model }) => model.familyId),
    archetype: candidate.archetype,
  };
}

class WorkerPool {
  private readonly workers: Worker[];
  private readonly ready: Promise<void>[];
  private readonly pending = new Map<number, { resolve(result: AttachmentMatchResult): void; reject(error: unknown): void }>();
  private nextId = 1;
  private nextWorker = 0;

  public constructor(private readonly dataset: ScamDataset, size: number) {
    this.workers = Array.from({ length: Math.max(1, size) }, () => new Worker(new URL("./matcher-worker.ts", import.meta.url)));
    this.ready = this.workers.map((worker) => {
      const readyPromise = new Promise<void>((resolve, reject) => {
        const onMessage = (message: { type: "ready" } | WorkerResponse) => {
          if ("type" in message && message.type === "ready") {
            worker.off("message", onMessage);
            resolve();
          }
        };
        worker.on("message", onMessage);
        worker.once("error", reject);
      });
      worker.postMessage({ type: "init", dataset: this.dataset });
      worker.on("message", (message: WorkerResponse) => {
        if (!("id" in message)) {
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        pending.resolve(message.result);
      });
      worker.on("error", (error) => {
        for (const [id, pending] of this.pending) {
          this.pending.delete(id);
          pending.reject(error);
        }
      });
      return readyPromise;
    });
  }

  public async run(buffer: Uint8Array): Promise<AttachmentMatchResult> {
    await Promise.all(this.ready);
    const worker = this.workers[this.nextWorker]!;
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    const id = this.nextId;
    this.nextId += 1;
    return await new Promise<AttachmentMatchResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "match", id, buffer } satisfies { type: "match" } & WorkerRequest);
    });
  }
}

export class AttachmentMatcher {
  private readonly dataset: ScamDataset;
  private readonly byRawSha = new Map<string, DatasetFingerprint[]>();
  private readonly workerPool: WorkerPool | null;

  public constructor(
    dataset: ScamDataset,
    options?: {
      useWorkers?: boolean;
      workerPoolSize?: number;
    },
  ) {
    this.dataset = dataset;
    for (const entry of dataset.fingerprints) {
      const rawMatches = this.byRawSha.get(entry.rawSha256) ?? [];
      rawMatches.push(entry);
      this.byRawSha.set(entry.rawSha256, rawMatches);
    }

    this.workerPool = options?.useWorkers
      ? new WorkerPool(dataset, options.workerPoolSize ?? Math.min(4, Math.max(1, cpus().length - 1)))
      : null;
  }

  public async matchBuffer(buffer: Uint8Array): Promise<AttachmentMatchResult> {
    const rawHash = rawSha256(buffer);
    const rawMatches = this.byRawSha.get(rawHash) ?? [];
    if (rawMatches.length > 0) {
      const rawDetails = rawMatches.map((reference) =>
        scoreAgainstReference(
          reference,
          {
            archetype: reference.archetype,
            aspectRatio: reference.aspectRatio,
            pHash: reference.pHash,
            dHash: reference.dHash,
            edgeHash: reference.edgeHash,
            lumaGrid: reference.lumaGrid,
            roiSignatures: reference.roiSignatures,
          },
          "exact-raw",
          rawMatches[0]?.roiSignatures.map(() => 0) ?? [],
        ),
      );
      return {
        classification: "scam",
        stage: "exact-raw",
        details: rawDetails,
        matchedFamilyId: rawMatches[0]?.familyId ?? null,
        confidence: 1,
        roiVotes: rawDetails[0]?.roiVotes ?? 4,
        rawMatches: rawDetails,
        familyCandidates: [],
        shortlistedFamilies: rawMatches.map((entry) => entry.familyId),
        archetype: rawMatches[0]?.archetype ?? null,
      };
    }

    if (this.workerPool) {
      return await this.workerPool.run(buffer);
    }

    const candidate = await extractCandidateFeatures(buffer, this.dataset.roiWindowsByArchetype);
    return evaluateCandidateAgainstDataset(candidate, this.dataset);
  }
}
