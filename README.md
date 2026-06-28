<center>
<img src="./datasets/allowed/goldensigma.gif" alt="Mario will save you" width="426" height="360">
</center>

# No Beast

Discord bot for detecting known the Mr Beast crypto casino scam where bots or compromised accounts send an empty message with 4 or 2 images.

Please note that everything is slopped.

<details>
<summary>Slopped description</summary>

## Overview

The project is intentionally conservative at runtime:

- exact raw file matches are always treated as `scam`
- visual matching is scam-only
- `borderline` results are logged but never enforced
- `safe` results do nothing

The current matcher is built around small curated image families under `datasets/scam`, not OCR or a general ML model.

## What It Does

When a user posts an image attachment in a guild where scanning is enabled, the bot:

1. downloads the image
2. computes visual features
3. compares the image against the scam dataset
4. classifies it as `safe`, `borderline`, or `scam`
5. enforces only when the classification is `scam`

If enforcement happens, the bot:

- deletes the message
- DMs the user a configurable message
- kicks the member
- writes a moderation log entry if a log channel is configured

If the image is only `borderline`, the bot writes a log entry and stops there.

## Slash Commands

The bot exposes one command: `/nobeast`

Supported subcommands:

- `status`
- `enable`
- `disable`
- `dryrun view`
- `dryrun enable`
- `dryrun disable`
- `message view`
- `message set`
- `message reset`
- `invite view`
- `invite set`
- `invite clear`
- `logchannel view`
- `logchannel set`
- `logchannel clear`

Notes:

- only members with `Manage Guild` can use the command
- custom kick messages must include `{serverName}`
- invite URLs must be Discord invite URLs
- log channels must be guild text channels

## Moderation Behavior

[src/moderation.ts](/C:/Users/Nick/Documents/ProgrammeerProjectjes/no-beast/src/moderation.ts) applies these filters before matching:

- ignore DMs
- ignore webhook messages
- ignore bot messages
- ignore servers where scanning is disabled
- only inspect image attachments
- ignore attachments larger than `15 MB`

Classification handling:

- `safe`: no action
- `borderline`: log only
- `scam`: delete, DM, kick, and log

Dry-run mode:

- never deletes
- never DMs
- never kicks
- still logs the analysis result

## Matching Pipeline

The core matcher lives in [src/matcher.ts](/C:/Users/Nick/Documents/ProgrammeerProjectjes/no-beast/src/matcher.ts).

### Runtime Stages

The classification pipeline is:

1. `exact-raw`
2. `family-consensus`

There is no normalized-SHA match stage anymore, and there is no permissive template-only fallback.

### Exact Raw Match

The first check is a raw SHA-256 hash on the original attachment bytes.

If the exact file exists in the scam dataset:

- classification is immediately `scam`
- stage is `exact-raw`

### Visual Family Match

If raw SHA does not match, the matcher extracts normalized visual features and runs family-aware comparison.

The image is assigned an archetype:

- `x-post`
- `withdrawal-proof`

This is currently based on aspect ratio, using a split threshold defined in [src/constants.ts](/C:/Users/Nick/Documents/ProgrammeerProjectjes/no-beast/src/constants.ts).

Then the matcher:

1. scores all scam family centroids within the same archetype
2. keeps a shortlist of the best families
3. scores the candidate against real reference members from the top family
4. applies consensus rules
5. returns `safe`, `borderline`, or `scam`

The result includes:

- `classification`
- `stage`
- `matchedFamilyId`
- `confidence`
- `roiVotes`
- `familyCandidates`
- `details`

## Image Features

[src/image-hash.ts](/C:/Users/Nick/Documents/ProgrammeerProjectjes/no-beast/src/image-hash.ts) normalizes every image to a `256x256` grayscale canvas using `sharp`.

The image is resized with `fit: "contain"`, which preserves layout and pads empty space instead of stretching the screenshot.

Extracted features:

- `rawSha256`: exact original-byte hash
- `pHash`: perceptual hash from a DCT over a `32x32` grayscale image
- `dHash`: difference hash from a `9x8` grayscale image
- `edgeHash`: perceptual hash of a simple edge image
- `lumaGrid`: `16x16` block-mean grayscale summary
- `roiSignatures`: `8x8` block-mean summaries for a few selected ROIs

### ROI

`ROI` stands for `Region of Interest`.

In this project, ROIs are rectangular parts of the normalized screenshot that are especially useful for distinguishing scam families. Instead of trusting whole-image similarity alone, the matcher also asks whether these more discriminative regions agree.

## Scam Dataset Model

[src/dataset.ts](/C:/Users/Nick/Documents/ProgrammeerProjectjes/no-beast/src/dataset.ts) treats each top-level folder in `datasets/scam` as a scam family.

For example:

- `datasets/scam/masowin/...`
- `datasets/scam/hesobia/...`

Each image becomes a `DatasetFingerprint` with:

- `familyId`
- `archetype`
- `rawSha256`
- `pHash`
- `dHash`
- `edgeHash`
- `lumaGrid`
- `roiSignatures`

### ROI Selection

For each archetype:

1. candidate `64x64` windows are laid out on the normalized `256x256` image
2. each candidate window is converted into a compact ROI signature
3. windows are scored by how well they separate families while staying consistent within a family
4. the best 4 windows are kept

### Family Models

Each family/archetype pair gets a centroid model with:

- centroid aspect ratio
- centroid pHash
- centroid dHash
- centroid edge hash
- centroid luma grid
- centroid ROI signatures
- thresholds derived from in-family spread

Families with fewer than 2 members are marked `borderlineOnly` and cannot pass the main acceptance rule directly.

## Consensus Rules

The matcher is intentionally conservative.

Main acceptance rule:

- top family is not `borderlineOnly`
- centroid score is within the family threshold
- at least 3 ROI votes pass
- at least 1 strong supporting family reference passes per-reference gates

Borderline rule:

- candidate is close to the top family
- candidate has strong support
- candidate did not satisfy full acceptance

Additional fallback acceptance rules exist for a few sparse-family cases in the current dataset. Those are there to preserve recall on the holdout scam fixtures while still keeping `datasets/allowed` safe.

## Worker Threads

The production matcher uses worker threads for the expensive visual path.

Main-thread behavior:

- raw SHA lookup always happens on the main thread
- if raw SHA matches, workers are bypassed

Worker-thread behavior:

- feature extraction
- archetype assignment
- family scoring
- classification

Notes:

- tests use the matcher with workers disabled for determinism
- the worker response is explicitly cloned into plain objects before posting back, to avoid runtime corruption of nested match-detail arrays

## DM Template

The pre-kick DM is rendered by [src/templates.ts](/C:/Users/Nick/Documents/ProgrammeerProjectjes/no-beast/src/templates.ts).

Behavior:

- uses a custom override if configured
- otherwise uses the default message from [src/constants.ts](/C:/Users/Nick/Documents/ProgrammeerProjectjes/no-beast/src/constants.ts)
- replaces `{serverName}` with the guild name
- appends the configured rejoin invite URL if present

## Datasets

The repository uses three dataset groups:

- `datasets/scam`
  - runtime-positive dataset
  - used to build matcher fingerprints and family models
- `datasets/allowed`
  - negative examples
  - used for tests and offline calibration only
- `datasets/evaluate`
  - holdout scam examples
  - used in tests

Only `datasets/scam` is loaded at runtime.

## Current Limitations

- the archetype gate is currently aspect-ratio based, not semantic
- thresholds are heuristic and tied to the current dataset
- no OCR
- no general-purpose scam detection outside the known families
- worker threads are used in production, but tests primarily validate the main-thread path

## Practical Summary

This bot is best understood as a curated-image family matcher for a known scam campaign pattern. It is not trying to detect every scam screenshot on the internet. It is trying to reliably catch screenshots that visually belong to the scam families stored in `datasets/scam`, while avoiding false positives on unrelated dark-theme screenshots.

</details>
