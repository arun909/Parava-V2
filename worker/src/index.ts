import type { Env } from "./env.ts";
import { JOBS } from "./jobs/index.ts";

export default {
  async scheduled(controller, env, ctx) {
    const now = new Date(controller.scheduledTime);
    for (const job of JOBS) {
      if (job.isDue(now)) ctx.waitUntil(job.run(env, now));
    }
  },

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return Response.json({ ok: true });
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
