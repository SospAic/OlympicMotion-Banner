/**
 * Banner Designer 鈥?Layer 1 glue script
 * Loads config 鈫?calls Runtime 鈫?paints DOM.
 * Never touches YouTube API directly.
 */
import { computeBannerState } from "/runtime/banner-runtime.js";

// 鈹€鈹€ Fallback config (used if JSON fetch fails) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const DEFAULTS = {
  brand: {
    channelName: "OlympicMotion",
    brandLine1:  "Olympic",
    brandLine2:  "Motion",
    slogan:      "Every Play Has A Story",
    sloganAccent:"Story",
    logo:        "/assets/logo.svg",
  },
  mission: {
    label:            "Mission",
    title:            "Road To <span>1M</span> Champions",
    goal:             1000000,
    cta:              "Subscribe & Be Part Of The Journey",
    subscribersLabel: "Subscribers",
    nextGoalLabel:    "Next Goal",
  },
  data: { subs: 46812 },
  social: {
    youtube:   "",
    instagram: "",
    tiktok:    "",
    x:         "",
  },
  features: [
    { icon: "trophy",   label: "Epic Moments" },
    { icon: "film",     label: "Untold Stories" },
    { icon: "medal",    label: "Olympic Legends" },
    { icon: "camera",   label: "Behind The Scenes" },
    { icon: "calendar", label: "Weekly Uploads" },
  ],
  achievements: [
    { label: "100",  caption: "Subscribers", threshold: 100 },
    { label: "1K",   caption: "Subscribers", threshold: 1000 },
    { label: "10K",  caption: "Subscribers", threshold: 10000 },
    { label: "50K",  caption: "Subscribers", threshold: 50000 },
    { label: "100K", caption: "Subscribers", threshold: 100000 },
    { label: "500K", caption: "Subscribers", threshold: 500000 },
    { label: "1M",   caption: "Subscribers", threshold: 1000000 },
  ],
  theme:               "gold",
  showSafeArea:        false,
  showProgressPercent: false,
};

// 鈹€鈹€ Config loader 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function loadConfig() {
  // Allow inline override via ?data=<url-encoded-json>
  const params = new URLSearchParams(location.search);
  const inline = params.get("data");
  if (inline) {
    try { return deepMerge(DEFAULTS, JSON.parse(decodeURIComponent(inline))); }
    catch { /* fall through */ }
  }

  try {
    const r = await fetch("/config/banner.config.json", { cache: "no-store" });
    if (r.ok) return deepMerge(DEFAULTS, await r.json());
  } catch { /* fall through */ }

  return DEFAULTS;
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = (v && typeof v === "object" && !Array.isArray(v))
      ? deepMerge(base[k] ?? {}, v)
      : v;
  }
  return out;
}

// 鈹€鈹€ DOM helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function setText(sel, text) {
  const el = document.querySelector(sel);
  if (el) el.textContent = text;
}

function setHTML(sel, html) {
  const el = document.querySelector(sel);
  if (el) el.innerHTML = html;
}

function setAttr(sel, attr, val) {
  const el = document.querySelector(sel);
  if (el) el.setAttribute(attr, val);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 鈹€鈹€ Social icons factory 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const SOCIAL_SVGS = {
  youtube:   `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.1 2.8 12 2.8 12 2.8s-4.1 0-6.8.2c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.2v2c0 2.1.3 4.2.3 4.2S1.3 19.6 2.2 20.4c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.8 12 21.8 12 21.8s4.1 0 6.8-.3c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zm-13.5 8.5V8.8l8 3.4-8 3.3z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.2 4.8 1.7 5 5 .1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.2 3.3-1.7 4.8-5 5-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.2-4.8-1.7-5-5C2.1 15.7 2 15.3 2 12c0-3.2 0-3.6.1-4.8.2-3.3 1.7-4.8 5-5C8.4 2.1 8.8 2.2 12 2.2zm0 1.8c-3.2 0-3.5 0-4.8.1-2.3.1-3.3 1.2-3.5 3.5-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c.1 2.3 1.2 3.3 3.5 3.5 1.2.1 1.5.1 4.8.1s3.5 0 4.8-.1c2.3-.1 3.3-1.2 3.5-3.5.1-1.2.1-1.5.1-4.7s0-3.5-.1-4.7c-.1-2.3-1.2-3.3-3.5-3.5C15.5 4 15.2 4 12 4zm0 3a5 5 0 1 1 0 10A5 5 0 0 1 12 7zm0 1.8a3.2 3.2 0 1 0 0 6.5 3.2 3.2 0 0 0 0-6.5zM17.2 6a1.2 1.2 0 1 1 0 2.4A1.2 1.2 0 0 1 17.2 6z"/></svg>`,
  tiktok:    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 3a3.8 3.8 0 0 1-3.8-3.8h-3v13.1a2.2 2.2 0 1 1-2.2-2.3c.2 0 .4 0 .6.1V6.8a6.4 6.4 0 1 0 5.4 6.3V9.2A9.4 9.4 0 0 0 22 10V7a3.8 3.8 0 0 1-2.4-.1z"/></svg>`,
  x:         `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.2 3h3.4l-7.4 8.5L23 21h-6.8l-5.3-7-6.1 7H1.4l7.9-9L1 3h7l4.8 6.4L18.2 3zm-1.2 16.2h1.9L7.1 5h-2l11.9 14.2z"/></svg>`,
};

function paintSocialIcons(social) {
  const container = document.querySelector("[data-social-icons]");
  if (!container) return;
  const links = Object.entries(social)
    .filter(([, url]) => url)
    .map(([platform, url]) => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = `social-icon social-icon--${platform}`;
      a.setAttribute("aria-label", platform);
      a.innerHTML = SOCIAL_SVGS[platform] ?? "";
      return a;
    });
  container.replaceChildren(...links);
}
function makeBadge(item, i) {
  const el = document.createElement("div");
  el.className = `badge${item.unlocked ? " is-unlocked" : ""}`;
  el.style.animationDelay = `${i * 30}ms`;
  el.innerHTML = `
    <svg viewBox="0 0 64 76" aria-hidden="true">
      <defs>
        <linearGradient id="badgeGold${i}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0"   stop-color="#fff4b8"/>
          <stop offset=".45" stop-color="#ffc233"/>
          <stop offset="1"   stop-color="#9a5f06"/>
        </linearGradient>
      </defs>
      <path d="M32 3 58 16v27c0 14-11 24-26 30C17 67 6 57 6 43V16L32 3Z"
            fill="${item.unlocked ? `url(#badgeGold${i})` : "rgba(255,255,255,.10)"}"
            stroke="${item.unlocked ? "#ffe896" : "rgba(255,255,255,.42)"}"
            stroke-width="2"/>
      ${item.unlocked
        ? `<path d="m20 36 8 8 18-23" fill="none" stroke="#1a1200"
                  stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M24 36h16v14H24V36Zm4-1v-4a4 4 0 0 1 8 0v4"
                  fill="rgba(255,255,255,.70)" stroke="none"/>`
      }
    </svg>
    <strong>${item.label}</strong>
    <span>${item.caption}</span>`;
  return el;
}

// 鈹€鈹€ Scale safe-area to fit viewport (kept for backward compat) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function updateScale() {
  // safe-area now uses 100% width 鈥?no transform needed
}

// 鈹€鈹€ Main paint function 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function paint(cfg) {
  const state = computeBannerState(cfg);

  // Safe-area guides
  document.documentElement.style.setProperty(
    "--safe-opacity", cfg.showSafeArea ? ".5" : "0"
  );

  document.title = `${cfg.brand.channelName} Banner`;

  // Logo
  const logo = document.querySelector("[data-logo]");
  if (logo) logo.src = cfg.brand.logo;

  // Brand lines
  setText("[data-brand-line1]", cfg.brand.brandLine1);
  setText("[data-brand-line2]", cfg.brand.brandLine2);

  // Slogan 鈥?accent word highlighted
  const sloganEl = document.querySelector("[data-slogan]");
  if (sloganEl) {
    const text   = cfg.brand.slogan  ?? "Every Play Has A Story";
    const accent = cfg.brand.sloganAccent ?? "";
    if (accent && text.includes(accent)) {
      const idx = text.lastIndexOf(accent);
      sloganEl.innerHTML =
        escHtml(text.slice(0, idx)) +
        `<em data-slogan-accent>${escHtml(accent)}</em>` +
        escHtml(text.slice(idx + accent.length));
    } else {
      sloganEl.textContent = text;
    }
  }

  // Mission
  setText("[data-mission-label]",    cfg.mission.label);
  setHTML("[data-mission-title]",    cfg.mission.title);

  // Live numbers
  setText("[data-subs]",             state.formatted.subscribers);   // 46812 (no comma)
  setText("[data-subscribers-label]",cfg.mission.subscribersLabel ?? "Subscribers");
  setText("[data-next-goal-label]",  cfg.mission.nextGoalLabel    ?? "Next Goal");
  setText("[data-next-goal]",        state.formatted.nextGoal);
  setText("[data-remaining]",        state.formatted.toNext);
  setText("[data-cta]",              cfg.mission.cta);

  // Progress bar 鈥?uses pctToNext (progress within current segment, not overall)
  const fill = document.querySelector("[data-progress-fill]");
  if (fill) {
    fill.style.width = "0%";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.width = `${state.pctToNext}%`;
      });
    });
  }

  // Achievements badges
  const grid = document.querySelector("[data-achievements]");
  if (grid) {
    grid.replaceChildren(...state.achievements.map(makeBadge));
  }

  // Social icons
  if (cfg.social) paintSocialIcons(cfg.social);

  updateScale();
}

// 鈹€鈹€ Boot 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
window.addEventListener("resize", updateScale, { passive: true });
loadConfig().then(paint);
