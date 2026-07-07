import { loadAttempts } from "./src/data-client.js";
import { buildMetrics, buildRiderSummary } from "./src/metrics.js";
import { escapeHtml, renderAttempt, renderMetrics, renderRiderCard } from "./src/renderers.js";

const dateInput = document.querySelector("#date");
const riderInput = document.querySelector("#riderId");
const statusEl = document.querySelector("#status");
const attemptMetaEl = document.querySelector("#attemptMeta");
const metricsEl = document.querySelector("#metrics");
const summaryEl = document.querySelector("#summary");
const resultsEl = document.querySelector("#results");
const loadButton = document.querySelector("#load");

dateInput.value = new Date().toISOString().slice(0, 10);

loadButton.addEventListener("click", loadResults);
loadResults();

async function loadResults() {
  statusEl.textContent = "Loading…";
  attemptMetaEl.textContent = "Loading…";
  metricsEl.replaceChildren();
  summaryEl.replaceChildren();
  resultsEl.replaceChildren();

  try {
    const attempts = await loadAttempts({
      date: dateInput.value,
      riderId: riderInput.value.trim()
    });
    const metrics = buildMetrics(attempts);
    const riderSummary = buildRiderSummary(attempts);

    statusEl.textContent = `${metrics.completedAttempts} completed of ${metrics.totalAttempts} attempt${metrics.totalAttempts === 1 ? "" : "s"}`;
    attemptMetaEl.textContent = metrics.bestTimeLabel;
    metricsEl.innerHTML = renderMetrics(metrics);
    summaryEl.innerHTML = riderSummary.map(renderRiderCard).join("") || `<p class="empty">No rider summary for this query.</p>`;
    resultsEl.innerHTML = attempts.map(renderAttempt).join("") || `<p class="empty">No attempts for this query.</p>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    statusEl.textContent = "Unable to load results";
    attemptMetaEl.textContent = "Check API connectivity";
    summaryEl.innerHTML = `<p class="empty">Could not load today’s metrics: ${escapeHtml(message)}</p>`;
  }
}
