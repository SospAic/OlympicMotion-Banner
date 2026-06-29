/**
 * Banner Runtime — Layer 2
 * Pure data transformation. No DOM, no API calls.
 * Safe to use in browser, Node, and Cloudflare Workers.
 */

const intFmt  = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const noComma = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, useGrouping: false });
const cptFmt  = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

export function formatInteger(v) {
  return intFmt.format(Math.round(Number(v) || 0));
}

export function formatPlain(v) {
  // No thousands separator — e.g. 46812 (not 46,812)
  return noComma.format(Math.round(Number(v) || 0));
}

export function formatCompact(v) {
  return cptFmt.format(Number(v) || 0);
}

/**
 * Given the full config object, compute every display value the banner needs.
 * @param {object} config
 * @returns {BannerState}
 */
export function computeBannerState(config) {
  const subscribers = Math.max(0, Number(config?.data?.subs ?? 0));
  const goal        = Math.max(1, Number(config?.mission?.goal ?? 100000));

  // Auto-detect next milestone from achievements
  const milestones = (config?.achievements ?? [])
    .map(a => Number(a.threshold ?? 0))
    .filter(t => t > 0)
    .sort((a, b) => a - b);

  const autoNext = milestones.find(t => t > subscribers) ?? goal;
  const nextGoal = Math.max(1, Number(config?.mission?.nextGoal ?? autoNext));

  // Progress to overall goal (for config display)
  const pctToGoal = clamp((subscribers / goal) * 100, 0, 100);

  // Progress to NEXT milestone (for the progress bar)
  // Find the milestone BEFORE nextGoal as the start point
  const prevMilestone = [...milestones].reverse().find(t => t <= subscribers) ?? 0;
  const segmentSize   = nextGoal - prevMilestone;
  const segmentDone   = subscribers - prevMilestone;
  const pctToNext     = clamp(segmentSize > 0 ? (segmentDone / segmentSize) * 100 : 100, 0, 100);

  const remaining = Math.max(goal - subscribers, 0);
  const toNext    = Math.max(nextGoal - subscribers, 0);

  const achievements = (config?.achievements ?? []).map(item => ({
    ...item,
    unlocked: subscribers >= Number(item.threshold ?? 0),
  }));

  return {
    subscribers,
    goal,
    nextGoal,
    prevMilestone,
    percent:    pctToGoal,
    pctToNext,
    remaining,
    toNext,
    achievements,
    formatted: {
      subscribers:      formatPlain(subscribers),   // no comma: 46812
      subscribersComma: formatInteger(subscribers), // with comma: 46,812
      goal:             formatInteger(goal),
      nextGoal:         formatCompact(nextGoal),
      pctToNext:        `${pctToNext.toFixed(1).replace(/\.0$/, "")}%`,
      percent:          `${pctToGoal.toFixed(pctToGoal >= 10 ? 1 : 2).replace(/\.0$/, "")}%`,
      remaining:        `${formatInteger(remaining)} To Go!`,
      toNext:           `${formatInteger(toNext)} To Go!`,
    },
  };
}
