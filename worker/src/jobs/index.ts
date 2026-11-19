import type { Env } from "../env.ts";

export interface Job {
  name: string;
  /** True when the job should run in the 15-minute slot starting at `now`. */
  isDue(now: Date): boolean;
  run(env: Env, now: Date): Promise<void>;
}

/** Jobs are added here as they are built (see the plan's "Live jobs" table). */
export const JOBS: Job[] = [];
