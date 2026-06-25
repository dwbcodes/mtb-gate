import { formatMs, formatTime } from "./formatters.js";

export function renderAttempt(attempt) {
  const reaction = formatMs(attempt.metrics.reactionMs);
  const launch = formatMs(attempt.metrics.launchMs);
  const course = formatMs(attempt.metrics.courseMs);
  const total = formatMs(attempt.metrics.totalMs);
  return `
    <article class="attempt">
      <header>
        <h3>${attempt.riderName}</h3>
        <p>${formatTime(attempt.queuedAt)} · ${attempt.runId}</p>
      </header>
      <dl>
        <div><dt>Status</dt><dd>${attempt.status}</dd></div>
        <div><dt>Reaction</dt><dd>${reaction}</dd></div>
        <div><dt>Launch</dt><dd>${launch}</dd></div>
        <div><dt>Course</dt><dd>${course}</dd></div>
        <div><dt>Total</dt><dd>${total}</dd></div>
      </dl>
    </article>
  `;
}

export function renderMetrics(metrics) {
  return [
    metricCard("Completed Runs", String(metrics.completedAttempts), `${metrics.pendingAttempts} pending / timed out`),
    metricCard("Best Time", metrics.bestTime, metrics.bestRider),
    metricCard("Average Time", metrics.averageTotal, "Across completed runs"),
    metricCard("Average Reaction", metrics.averageReaction, "Launch to tube trigger")
  ].join("");
}

export function renderRiderCard(rider) {
  return `
    <article class="rider-card">
      <header>
        <h3>${rider.riderName}</h3>
        <p>${rider.completedRuns} completed / ${rider.totalRuns} total</p>
      </header>
      <dl>
        <div><dt>Best</dt><dd>${formatMs(rider.bestTotalMs)}</dd></div>
        <div><dt>Average</dt><dd>${formatMs(rider.averageTotalMs)}</dd></div>
        <div><dt>Reaction</dt><dd>${formatMs(rider.averageReactionMs)}</dd></div>
      </dl>
    </article>
  `;
}

function metricCard(label, value, detail) {
  return `
    <article class="metric-card">
      <p>${label}</p>
      <strong>${value}</strong>
      <span>${detail}</span>
    </article>
  `;
}
