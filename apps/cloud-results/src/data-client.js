const apiBase = globalThis.MTB_GATE_API_BASE ?? "http://localhost:8787";

export async function loadAttempts({ date, riderId }) {
  const url = new URL(`${apiBase}/results`);
  url.searchParams.set("date", date);
  if (riderId) {
    url.searchParams.set("riderId", riderId);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Results API returned ${response.status}`);
  }

  const payload = await response.json();
  return (payload.attempts ?? []).slice().sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
}

