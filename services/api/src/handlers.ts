import type { DailyResultsResponse, DeviceUploadEnvelope } from "../../../packages/contracts/src/index.ts";
import type { AttemptStore } from "./store.ts";

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function createJsonResponse(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    },
    body: JSON.stringify(body, null, 2)
  };
}

export async function postAttempts(requestBody: string, store: AttemptStore): Promise<HttpResponse> {
  let envelope: DeviceUploadEnvelope;
  try {
    envelope = JSON.parse(requestBody) as DeviceUploadEnvelope;
  } catch {
    return createJsonResponse(400, { error: "Invalid JSON" });
  }
  if (!envelope.runId || !envelope.attempt?.riderId) {
    return createJsonResponse(400, { error: "Invalid attempt payload" });
  }

  const result = store.ingest(envelope);
  return createJsonResponse(result.created ? 201 : 200, {
    accepted: true,
    duplicate: !result.created,
    runId: result.attempt.runId
  });
}

export async function getResults(url: URL, store: AttemptStore): Promise<HttpResponse> {
  const date = url.searchParams.get("date");
  if (!date) {
    return createJsonResponse(400, { error: "Query param 'date' is required" });
  }

  const response: DailyResultsResponse = {
    date,
    attempts: store.queryResults({
      date,
      riderId: url.searchParams.get("riderId") ?? undefined
    })
  };

  return createJsonResponse(200, response);
}

export async function getRoster(store: AttemptStore): Promise<HttpResponse> {
  return createJsonResponse(200, store.roster());
}

