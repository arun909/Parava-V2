export interface Env {
  /** Operational database: recent sightings, subscriptions, sent alerts. */
  DB: D1Database;
  /** Exported files (`v/{run}/`, `live/`) served behind the CDN. */
  FILES: R2Bucket;
  EBIRD_API_KEY: string;
}
