/**
 * app-static.js — Dynamic data layer for banner-static.html
 * Only updates: subs number, next goal, remaining, percent, progress bar, badges, social icons
 * All visual styling is locked in banner-static.css
 */
import { computeBannerState } from "/runtime/banner-runtime.js";

const DEFAULTS = {
  brand:   { logo: "/assets/logo.svg" },
  mission: { goal: 1000000 },
  data:    { subs: 46812 },
  social:  { youtube: "", instagram: "", tiktok: "", x: "" },
  achievements: [
    { label: "100",  caption: "Subscribers", threshold: 100 },
    { label: "1K",   caption: "Subscribers", threshold: 1000 },
    { label: "10K",  caption: "Subscribers", threshold: 10000 },
    { label: "50K",  caption: "Subscribers", threshold: 50000 },
    { label: "100K", caption: "Subscribers", threshold: 100000 },
    { label: "500K", caption: "Subscribers", threshold: 500000 },
    { label: "1M",   caption: "Subscribers", threshold: 1000000 },
  ],
};

async function loadConfig() {
  const params = new URLSearchParams(location.search);
  const inline = params.get("data");
  if (inline) {
    try { return merge(DEFAULTS, JSON.parse(decodeURIComponent(inline))); } catch {}
  }
  try {
    const r = await fetch("/config/banner.config.json", { cache: "no-store" });
    if (r.ok) return merge(DEFAULTS, await r.json());
  } catch {}
  return DEFAULTS;
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = (v && typeof v === "object" && !Array.isArray(v))
      ? merge(base[k] ?? {}, v) : v;
  }
  return out;
}

function set(sel, val) {
  const el = document.querySelector(sel);
  if (el) el.textContent = val;
}

// ── Badge SVG factory ─────────────────────────────────────────────────────
function makeBadge(item, i) {
  const el = document.createElement("div");
  el.className = `bs-badge${item.unlocked ? " is-unlocked" : ""}`;
  el.style.animationDelay = `${i * 60}ms`;

  const unlocked = item.unlocked;
  el.innerHTML = `
    <svg viewBox="0 0 64 76" aria-hidden="true">
      <defs>
        <linearGradient id="bg${i}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0"   stop-color="#fff4b8"/>
          <stop offset=".45" stop-color="#ffc233"/>
          <stop offset="1"   stop-color="#9a5f06"/>
        </linearGradient>
      </defs>
      <path d="M32 3 58 16v27c0 14-11 24-26 30C17 67 6 57 6 43V16L32 3Z"
            fill="${unlocked ? `url(#bg${i})` : "rgba(255,255,255,.10)"}"
            stroke="${unlocked ? "#ffe896" : "rgba(255,255,255,.38)"}"
            stroke-width="2"/>
      ${unlocked
        ? `<path d="m20 36 8 8 18-23" fill="none" stroke="#1a1200" stroke-width="6"
                  stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M24 36h16v14H24V36Zm4-1v-4a4 4 0 0 1 8 0v4"
                  fill="rgba(255,255,255,.68)" stroke="none"/>`
      }
    </svg>
    <strong>${item.label}</strong>
    <small>${item.caption}</small>`;
  return el;
}

// ── Social icons ──────────────────────────────────────────────────────────
const SVGS = {
  youtube:   `<svg viewBox="0 0 24 24"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.1 2.8 12 2.8 12 2.8s-4.1 0-6.8.2c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.2v2c0 2.1.3 4.2.3 4.2S1.3 19.6 2.2 20.4c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.8 12 21.8 12 21.8s4.1 0 6.8-.3c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zm-13.5 8.5V8.8l8 3.4-8 3.3z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.2 4.8 1.7 5 5 .1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.2 3.3-1.7 4.8-5 5-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.2-4.8-1.7-5-5C2.1 15.7 2 15.3 2 12c0-3.2 0-3.6.1-4.8.2-3.3 1.7-4.8 5-5C8.4 2.1 8.8 2.2 12 2.2zm0 1.8c-3.2 0-3.5 0-4.8.1-2.3.1-3.3 1.2-3.5 3.5-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c.1 2.3 1.2 3.3 3.5 3.5 1.2.1 1.5.1 4.8.1s3.5 0 4.8-.1c2.3-.1 3.3-1.2 3.5-3.5.1-1.2.1-1.5.1-4.7s0-3.5-.1-4.7c-.1-2.3-1.2-3.3-3.5-3.5C15.5 4 15.2 4 12 4zm0 3a5 5 0 1 1 0 10A5 5 0 0 1 12 7zm0 1.8a3.2 3.2 0 1 0 0 6.5 3.2 3.2 0 0 0 0-6.5zM17.2 6a1.2 1.2 0 1 1 0 2.4A1.2 1.2 0 0 1 17.2 6z"/></svg>`,
  tiktok:    `<svg viewBox="0 0 24 24"><path d="M19.6 3a3.8 3.8 0 0 1-3.8-3.8h-3v13.1a2.2 2.2 0 1 1-2.2-2.3c.2 0 .4 0 .6.1V6.8a6.4 6.4 0 1 0 5.4 6.3V9.2A9.4 9.4 0 0 0 22 10V7a3.8 3.8 0 0 1-2.4-.1z"/></svg>`,
  x:         `<svg viewBox="0 0 24 24"><path d="M18.2 3h3.4l-7.4 8.5L23 21h-6.8l-5.3-7-6.1 7H1.4l7.9-9L1 3h7l4.8 6.4L18.2 3zm-1.2 16.2h1.9L7.1 5h-2l11.9 14.2z"/></svg>`,
};

function paintSocial(social) {
  const c = document.querySelector("[data-social-icons]");
  if (!c) return;
  const links = Object.entries(social)
    .filter(([, url]) => url)
    .map(([p, url]) => {
      const a = document.createElement("a");
      a.href = url;
      a.className = "bs-social-icon";
      a.setAttribute("aria-label", p);
      a.innerHTML = SVGS[p] ?? "";
      return a;
    });
  c.replaceChildren(...links);
}

// ── Main paint ────────────────────────────────────────────────────────────
function paint(cfg) {
  const s = computeBannerState(cfg);

  // Logo
  const logo = document.querySelector("[data-logo]");
  if (logo) logo.src = cfg.brand.logo;

  // Mission goal in title (e.g. "100K")
  const { formatCompact } = window.__runtime ?? {};
  set("[data-mission-goal]", formatCompact
    ? formatCompact(cfg.mission.goal)
    : cfg.mission.goal >= 1e6
      ? (cfg.mission.goal / 1e6) + "M"
      : (cfg.mission.goal / 1e3) + "K"
  );

  // Dynamic numbers
  set("[data-subs]",      s.formatted.subscribersComma ?? s.formatted.subscribers);
  set("[data-next-goal]", s.formatted.nextGoal);
  set("[data-remaining]", s.formatted.toNext);
  set("[data-percent]",   s.formatted.pctToNext);
  set("[data-goal]",      s.formatted.goal);

  // Progress bar — uses pctToNext (current segment progress)
  const fill = document.querySelector("[data-progress-fill]");
  if (fill) {
    fill.style.width = "0%";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.width = `${s.pctToNext}%`;
    }));
  }

  // Badges
  const grid = document.querySelector("[data-achievements]");
  if (grid) grid.replaceChildren(...s.achievements.map(makeBadge));

  // Social
  if (cfg.social) paintSocial(cfg.social);

  document.title = `${cfg.brand?.channelName ?? "OlympicMotion"} Banner`;
}

// Boot
loadConfig().then(paint);
