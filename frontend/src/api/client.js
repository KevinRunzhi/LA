import {
  buildFallbackRecord,
  fallbackDiagnosis,
  fallbackEvidence,
  fallbackExpertReview,
  fallbackGraph,
  fallbackGuideSteps,
  fallbackScenario,
} from "../data/fallbackDemo";

const API_BASE = "";
const completedStepIds = new Set();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function request(path, options = {}, fallback) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API ${path} failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (fallback === undefined) throw error;
    return typeof fallback === "function" ? fallback(error) : clone(fallback);
  }
}

function offlineSteps() {
  return clone(fallbackGuideSteps).map((step) => ({
    ...step,
    completed: completedStepIds.has(step.id),
  }));
}

export const api = {
  health: () => request("/api/health", {}, { status: "offline", service: "la-mvp-frontend-demo" }),
  scenario: () => request("/api/demo/scenario", {}, fallbackScenario),
  startDiagnosis: (input) =>
    request(
      "/api/diagnosis/start",
      {
        method: "POST",
        body: JSON.stringify({ input }),
      },
      () => ({ ...clone(fallbackDiagnosis), input: input || fallbackScenario.default_input, expert_review_applied: false })
    ),
  steps: () => request("/api/guide/steps", {}, offlineSteps),
  completeStep: (stepId) =>
    request(
      `/api/guide/steps/${stepId}/complete`,
      { method: "POST" },
      () => {
        completedStepIds.add(stepId);
        return { step_id: stepId, completed: true };
      }
    ),
  generateRecord: () =>
    request(
      "/api/records/generate",
      { method: "POST", body: "{}" },
      () => buildFallbackRecord(offlineSteps().filter((step) => step.completed))
    ),
  evidence: () => request("/api/knowledge/evidence", {}, fallbackEvidence),
  graph: () => request("/api/knowledge/graph", {}, fallbackGraph),
  expertReview: () =>
    request("/api/expert/review", { method: "POST", body: "{}" }, fallbackExpertReview),
};
