import { parentPort } from "node:worker_threads";
import { evaluateCandidateAgainstDataset, extractCandidateFeatures } from "./matcher.js";
import type { Archetype, AttachmentMatchResult, MatchDetail, RoiWindow, ScamDataset } from "./types.js";

if (!parentPort) {
  throw new Error("matcher-worker must run in a worker thread");
}

let dataset: ScamDataset | null = null;

function cloneUint8Array(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

function cloneMatchDetail(detail: MatchDetail): MatchDetail {
  return {
    reference: {
      ...detail.reference,
      lumaGrid: cloneUint8Array(detail.reference.lumaGrid),
      roiSignatures: detail.reference.roiSignatures.map((signature) => cloneUint8Array(signature)),
    },
    stage: detail.stage,
    aspectRatioDelta: detail.aspectRatioDelta,
    pHashDistance: detail.pHashDistance,
    dHashDistance: detail.dHashDistance,
    edgeHashDistance: detail.edgeHashDistance,
    lumaMae: detail.lumaMae,
    templateMae: detail.templateMae,
    memberScore: detail.memberScore,
    roiMae: [...detail.roiMae],
    roiVotes: detail.roiVotes,
  };
}

function cloneMatchResult(result: AttachmentMatchResult): AttachmentMatchResult {
  return {
    ...result,
    details: result.details.map((detail) => cloneMatchDetail(detail)),
    rawMatches: result.rawMatches.map((detail) => cloneMatchDetail(detail)),
    familyCandidates: result.familyCandidates.map((detail) => cloneMatchDetail(detail)),
    shortlistedFamilies: [...result.shortlistedFamilies],
  };
}

function normalizeRoiWindowsByArchetype(source: unknown, familyModels: ScamDataset["familyModels"]): Record<Archetype, RoiWindow[]> {
  const base: Record<Archetype, RoiWindow[]> = {
    "x-post": [],
    "withdrawal-proof": [],
  };

  if (source && typeof source === "object") {
    const xPost = (source as Record<string, unknown>)["x-post"];
    const withdrawalProof = (source as Record<string, unknown>)["withdrawal-proof"];
    if (Array.isArray(xPost)) {
      base["x-post"] = xPost as RoiWindow[];
    }
    if (Array.isArray(withdrawalProof)) {
      base["withdrawal-proof"] = withdrawalProof as RoiWindow[];
    }
  }

  if (base["x-post"].length === 0) {
    base["x-post"] = familyModels.find((model) => model.archetype === "x-post")?.roiWindows ?? [];
  }
  if (base["withdrawal-proof"].length === 0) {
    base["withdrawal-proof"] =
      familyModels.find((model) => model.archetype === "withdrawal-proof")?.roiWindows ?? [];
  }

  return base;
}

parentPort.on("message", async (message: { type: "init"; dataset: ScamDataset } | { type: "match"; id: number; buffer: Uint8Array }) => {
  if (message.type === "init") {
    dataset = {
      ...message.dataset,
      roiWindowsByArchetype: normalizeRoiWindowsByArchetype(
        message.dataset.roiWindowsByArchetype,
        message.dataset.familyModels,
      ),
    };
    parentPort?.postMessage({ type: "ready" });
    return;
  }

  if (!dataset) {
    throw new Error("matcher-worker received work before initialization");
  }

  const candidate = await extractCandidateFeatures(message.buffer, dataset.roiWindowsByArchetype);
  const result = evaluateCandidateAgainstDataset(candidate, dataset);
  parentPort?.postMessage({ id: message.id, result: cloneMatchResult(result) });
});
