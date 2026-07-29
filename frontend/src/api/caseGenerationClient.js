import { jsonBody, platformRequest } from "./platformTransport";

export const caseGenerationApi = {
  templates: () => platformRequest("/case-generation/templates"),
  sources: () => platformRequest("/case-generation/sources"),
  jobs: (limit = 100) => platformRequest(`/case-generation/jobs?limit=${limit}`),
  createJob: (input) => platformRequest("/case-generation/jobs", {
    method: "POST",
    body: jsonBody(input),
  }),
  job: (jobId) => platformRequest(`/case-generation/jobs/${encodeURIComponent(jobId)}`),
  run: (jobId) => platformRequest(`/case-generation/jobs/${encodeURIComponent(jobId)}/run`, {
    method: "POST",
  }),
  cancel: (jobId) => platformRequest(`/case-generation/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  }),
  approveOutline: (jobId) => platformRequest(
    `/case-generation/jobs/${encodeURIComponent(jobId)}/outline/approve`,
    { method: "POST" },
  ),
  confirmDomain: (jobId, templateId) => platformRequest(
    `/case-generation/jobs/${encodeURIComponent(jobId)}/domain/confirm`,
    { method: "POST", body: jsonBody({ templateId }) },
  ),
  rejectOutline: (jobId, notes = "") => platformRequest(
    `/case-generation/jobs/${encodeURIComponent(jobId)}/outline/reject`,
    { method: "POST", body: jsonBody({ notes }) },
  ),
  artifacts: (jobId) => platformRequest(
    `/case-generation/jobs/${encodeURIComponent(jobId)}/artifacts`,
  ),
  agentRuns: (jobId) => platformRequest(
    `/case-generation/jobs/${encodeURIComponent(jobId)}/agent-runs`,
  ),
  patches: (jobId) => platformRequest(
    `/case-generation/jobs/${encodeURIComponent(jobId)}/patches`,
  ),
  acceptPatch: (patchId, operationIndexes = null) => platformRequest(
    `/case-generation/patches/${encodeURIComponent(patchId)}/accept`,
    {
      method: "POST",
      body: jsonBody(operationIndexes ? { operationIndexes } : {}),
    },
  ),
  rejectPatch: (patchId) => platformRequest(
    `/case-generation/patches/${encodeURIComponent(patchId)}/reject`,
    { method: "POST" },
  ),
  applyPatch: (patchId) => platformRequest(
    `/case-generation/patches/${encodeURIComponent(patchId)}/apply`,
    { method: "POST" },
  ),
};
