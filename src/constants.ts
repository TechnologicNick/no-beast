export const APP_NAME = "no-beast";
export const COMMAND_NAME = "nobeast";
export const DEFAULT_DB_PATH = "./data/no-beast.sqlite";
export const DEFAULT_KICK_MESSAGE =
  "You were automatically removed from {serverName} because an attachment you posted matched a known scam image. You may rejoin the server if this was a mistake or if you have recovered your account.";
export const MAX_CUSTOM_MESSAGE_LENGTH = 1500;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const NORMALIZED_IMAGE_SIZE = 256;
export const LUMA_GRID_SIZE = 16;
export const ROI_GRID_SIZE = 8;
export const ROI_WINDOW_SIZE = 64;
export const ROI_COUNT = 4;
export const ARCHETYPE_ASPECT_RATIO_SPLIT = 0.9;

export const SHORTLIST_LIMIT = 3;
export const GLOBAL_SCORE_MARGIN = 3;
export const BORDERLINE_SCORE_MARGIN = 7;
export const MEMBER_SCORE_MARGIN = 4;
export const ROI_MAE_MARGIN = 5;

export const MAX_GLOBAL_SCORE = 46;
export const MAX_BORDERLINE_SCORE = 56;
export const MAX_MEMBER_SCORE = 50;
export const MAX_ASPECT_RATIO_DELTA = 0.16;
export const MAX_PHASH_DISTANCE = 18;
export const MAX_DHASH_DISTANCE = 18;
export const MAX_EDGEHASH_DISTANCE = 18;
export const MAX_LUMA_MAE = 34;
