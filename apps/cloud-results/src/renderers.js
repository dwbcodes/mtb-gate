import { formatMs, formatTime } from "./formatters.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderAttempt(attempt) {
  const reaction = formatMs(attempt.metrics.reactionMs);
  const launch = formatMs(attempt.metrics.launchMs);
  const course = formatMs(attempt.metrics.courseMs);
  const total = formatMs(attempt.metrics.totalMs);
  return `
    <article class="attempt">
      <header>
        <h3>${escapeHtml(attempt.riderName)}</h3>
        <p>${escapeHtml(formatTime(attempt.queuedAt))} · ${escapeHtml(attempt.runId)}</p>
      </header>
      <dl>
        <div><dt>Status</dt><dd>${escapeHtml(attempt.status)}</dd></div>
        <div><dt>Reaction</dt><dd>${escapeHtml(reaction)}</dd></div>
        <div><dt>Launch</dt><dd>${escapeHtml(launch)}</dd></div>
        <div><dt>Course</dt><dd>${escapeHtml(course)}</dd></div>
        <div><dt>Total</dt><dd>${escapeHtml(total)}</dd></div>
      </dl>
    </article>
  `;
}

export function renderMetrics(metrics) {
  return [
    metricCard("Completed Runs", String(metrics.completedAttempts), `${metrics.pendingAttempts} pending / timed out`),
    metricCard("Best Time", metrics.bestTime, metrics.bestRider),
    metricCard("Average Time", metrics.averageTotal, "Across completed runs"),
    metricCard("Average Reaction", metrics.averageReaction, "GO signal to sensor trigger")
  ].join("");
}

export function renderRiderCard(rider) {
  return `
    <article class="rider-card">
      <header>
        <h3>${escapeHtml(rider.riderName)}</h3>
        <p>${escapeHtml(rider.completedRuns)} completed / ${escapeHtml(rider.totalRuns)} total</p>
      </header>
      <dl>
        <div><dt>Best</dt><dd>${escapeHtml(formatMs(rider.bestTotalMs))}</dd></div>
        <div><dt>Average</dt><dd>${escapeHtml(formatMs(rider.averageTotalMs))}</dd></div>
        <div><dt>Reaction</dt><dd>${escapeHtml(formatMs(rider.averageReactionMs))}</dd></div>
      </dl>
    </article>
  `;
}

function metricCard(label, value, detail) {
  return `
    <article class="metric-card">
      <p>${escapeHtml(label)}</p>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(detail)}</span>
    </article>
  `;
}
