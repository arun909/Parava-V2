import type { Stage } from "../stage.ts";

/** Derive region_week, phenology, cell_week, site_month and route_week. */
export default {
  name: "model",
  async run() {
    throw new Error("model: not implemented");
  },
} satisfies Stage;
