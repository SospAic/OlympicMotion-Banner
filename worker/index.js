/**
 * Banner Runtime Worker — Layer 2 (Cloudflare Workers)
 *
 * Routes:
 *   GET /api/banner-state?subs=46812&goal=100000
 *     → JSON with all computed display values
 *
 *   GET /api/health
 *     → { status: "ok", ts: <iso> }
 *
 *   GET /*
 *     → 200 plain text (Cloudflare Pages serves static files)
 */

import { computeBannerState } from "../public/runtime/banner-runtime.js";

const ACHIEVEMENTS = [
  { label: "100",  caption: "Subscribers", threshold: 100 },
  { label: "1K",   caption: "Subscribers", threshold: 1000 },
  { label: "10K",  caption: "Subscribers", threshold: 10000 },
  { label: "50K",  caption: "Subscribers", threshold: 50000 },
  { label: "100K", caption: "Subscribers", threshold: 100000 },
  { label: "500K", caption: "Subscribers", threshold: 500000 },
  { label: "1M",   caption: "Subscribers", threshold: 1000000 },
];

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/health") {
      return Response.json(
        { status: "ok", ts: new Date().toISOString() },
        { headers: { ...CORS, "cache-control": "no-store" } }
      );
    }

    if (url.pathname === "/api/banner-state") {
      const subs = Number(url.searchParams.get("subs") || env.SUBSCRIBERS || 0);
      const goal = Number(url.searchParams.get("goal") || env.GOAL || 100000);

      const state = computeBannerState({
        data:         { subs },
        mission:      { goal },
        achievements: ACHIEVEMENTS,
      });

      return Response.json(state, {
        headers: {
          ...CORS,
          "cache-control": "public, max-age=300, stale-while-revalidate=60",
        },
      });
    }

    return new Response("OlympicMotion Banner Engine", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
