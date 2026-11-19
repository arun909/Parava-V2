import type { Stage } from "../stage.ts";

/** Apply sanity rules, set confidence and flags, write the run report. */
export default {
  name: "verify",
  async run() {
    throw new Error("verify: not implemented");
  },
} satisfies Stage;
