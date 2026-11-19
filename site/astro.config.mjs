import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";

// Static output for Cloudflare Pages; Svelte is used only for islands.
export default defineConfig({
  output: "static",
  integrations: [svelte()],
});
