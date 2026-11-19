import type { Stage } from "../stage.ts";

/** Read the GBIF snapshot into the occurrence and effort tables. */
export default {
  name: "ingest",
  async run() {
    throw new Error("ingest: not implemented");
  },
} satisfies Stage;
