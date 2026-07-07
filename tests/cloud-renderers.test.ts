import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore cloud-results is plain browser JS without declaration files.
import { escapeHtml, renderAttempt, renderRiderCard } from "../apps/cloud-results/src/renderers.js";

test("escapeHtml escapes dynamic text for string renderers", () => {
  assert.equal(escapeHtml(`<script>"x" & 'y'</script>`), "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;");
});

test("cloud result renderers escape rider and run fields", () => {
  const attemptHtml = renderAttempt({
    riderName: `<img src=x onerror=alert(1)>`,
    queuedAt: "2026-05-19T08:00:00.000Z",
    runId: `run-<bad>`,
    status: `finished<script>`,
    metrics: {
      reactionMs: 100,
      launchMs: 200,
      courseMs: 300,
      totalMs: 400
    }
  });

  assert.match(attemptHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(attemptHtml, /run-&lt;bad&gt;/);
  assert.match(attemptHtml, /finished&lt;script&gt;/);
  assert.doesNotMatch(attemptHtml, /<img src=x/);

  const riderHtml = renderRiderCard({
    riderName: `<b>Ada</b>`,
    completedRuns: 1,
    totalRuns: 2,
    bestTotalMs: 400,
    averageTotalMs: 500,
    averageReactionMs: 100
  });

  assert.match(riderHtml, /&lt;b&gt;Ada&lt;\/b&gt;/);
  assert.doesNotMatch(riderHtml, /<b>Ada<\/b>/);
});
