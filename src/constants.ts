export const APP_NAME = "no-beast";
export const COMMAND_NAME = "nobeast";
export const DEFAULT_DB_PATH = "./data/no-beast.sqlite";
export const DEFAULT_KICK_MESSAGE =
  "You were automatically removed from {serverName} because an attachment you posted matched a known scam image. You may rejoin the server if this was a mistake or if you have recovered your account.";
export const MAX_CUSTOM_MESSAGE_LENGTH = 1500;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export const ASPECT_RATIO_DELTA_THRESHOLD = 0.08;
export const PHASH_DISTANCE_THRESHOLD = 6;
export const DHASH_DISTANCE_THRESHOLD = 6;
export const MIN_NEAR_DUPLICATE_MATCHES = 2;
export const TEMPLATE_MAE_THRESHOLD = 25;
