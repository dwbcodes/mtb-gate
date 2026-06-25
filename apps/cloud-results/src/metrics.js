import { averageMs, formatAverage, formatMs } from "./formatters.js";

export function buildMetrics(attempts) {
  const completed = attempts.filter((attempt) => attempt.metrics.totalMs != null);
  const bestAttempt = completed.reduce((best, attempt) => {
    if (!best || attempt.metrics.totalMs < best.metrics.totalMs) {
      return attempt;
    }
    return best;
  }, null);

  return {
    totalAttempts: attempts.length,
    completedAttempts: completed.length,
    pendingAttempts: attempts.length - completed.length,
    bestTime: bestAttempt ? formatMs(bestAttempt.metrics.totalMs) : "Pending",
    bestRider: bestAttempt ? `${bestAttempt.riderName} leads today` : "No finished runs yet",
    bestTimeLabel: bestAttempt ? `Fastest run: ${bestAttempt.riderName} in ${formatMs(bestAttempt.metrics.totalMs)}` : "No completed runs yet",
    averageTotal: formatAverage(completed.map((attempt) => attempt.metrics.totalMs)),
    averageReaction: formatAverage(completed.map((attempt) => attempt.metrics.reactionMs)),
    averageLaunch: formatAverage(completed.map((attempt) => attempt.metrics.launchMs))
  };
}

export function buildRiderSummary(attempts) {
  const riders = new Map();
  for (const attempt of attempts) {
    const current = riders.get(attempt.riderId) ?? {
      riderId: attempt.riderId,
      riderName: attempt.riderName,
      totalRuns: 0,
      completedRuns: 0,
      bestTotalMs: null,
      totals: [],
      reactions: [],
      launches: []
    };

    current.totalRuns += 1;
    if (attempt.metrics.totalMs != null) {
      current.completedRuns += 1;
      current.totals.push(attempt.metrics.totalMs);
      if (attempt.metrics.reactionMs != null) {
        current.reactions.push(attempt.metrics.reactionMs);
      }
      if (attempt.metrics.launchMs != null) {
        current.launches.push(attempt.metrics.launchMs);
      }
      current.bestTotalMs = current.bestTotalMs == null
        ? attempt.metrics.totalMs
        : Math.min(current.bestTotalMs, attempt.metrics.totalMs);
    }

    riders.set(attempt.riderId, current);
  }

  return [...riders.values()]
    .map((rider) => ({
      riderId: rider.riderId,
      riderName: rider.riderName,
      totalRuns: rider.totalRuns,
      completedRuns: rider.completedRuns,
      bestTotalMs: rider.bestTotalMs,
      averageTotalMs: averageMs(rider.totals),
      averageReactionMs: averageMs(rider.reactions),
      averageLaunchMs: averageMs(rider.launches)
    }))
    .sort((left, right) => {
      if (left.bestTotalMs == null && right.bestTotalMs == null) {
        return left.riderName.localeCompare(right.riderName);
      }
      if (left.bestTotalMs == null) {
        return 1;
      }
      if (right.bestTotalMs == null) {
        return -1;
      }
      return left.bestTotalMs - right.bestTotalMs;
    });
}

