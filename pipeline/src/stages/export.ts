import type { Stage } from "../stage.ts";

/** Write versioned JSON files to v/{run}/, checked against shared schemas. */
export default {
  name: "export",
  async run() {
    throw new Error("export: not implemented");
  },
} satisfies Stage;
