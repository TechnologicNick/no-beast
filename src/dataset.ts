import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { SUPPORTED_IMAGE_EXTENSIONS } from "./constants.js";
import { normalizeImage, normalizedSha256, rawSha256 } from "./image-hash.js";
import type { DatasetFingerprint } from "./types.js";

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

export async function loadDatasetFingerprints(
  datasetRoot: string,
  options?: {
    excludedDirectoryNames?: Iterable<string>;
  },
): Promise<DatasetFingerprint[]> {
  const root = resolve(datasetRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Dataset root is not a directory: ${datasetRoot}`);
  }

  const files: string[] = [];
  walk(root, files, new Set(options?.excludedDirectoryNames ?? []));

  const fingerprints: DatasetFingerprint[] = [];
  for (const file of files.sort()) {
    const bytes = readFileSync(file);
    const normalized = await normalizeImage(bytes);
    fingerprints.push({
      id: relative(root, file).replaceAll("\\", "/"),
      relativePath: relative(root, file).replaceAll("\\", "/"),
      rawSha256: rawSha256(bytes),
      normalizedSha256: normalizedSha256(normalized.normalizedBytes),
      aspectRatio: normalized.aspectRatio,
      pHash: normalized.pHash,
      dHash: normalized.dHash,
      templateVector: normalized.templateVector,
    });
  }

  return fingerprints;
}
