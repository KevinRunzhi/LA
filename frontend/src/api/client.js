const API_BASE = "";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API ${path} failed: ${response.status}`);
  }

  return response.json();
}

export const api = {
  health: () => request("/api/health"),
  scenario: () => request("/api/demo/scenario"),
  startDiagnosis: (input) =>
    request("/api/diagnosis/start", {
      method: "POST",
      body: JSON.stringify({ input }),
    }),
  steps: () => request("/api/guide/steps"),
  completeStep: (stepId) =>
    request(`/api/guide/steps/${stepId}/complete`, { method: "POST" }),
  generateRecord: () =>
    request("/api/records/generate", { method: "POST", body: "{}" }),
  evidence: () => request("/api/knowledge/evidence"),
  graph: () => request("/api/knowledge/graph"),
  expertReview: () =>
    request("/api/expert/review", { method: "POST", body: "{}" }),
};
