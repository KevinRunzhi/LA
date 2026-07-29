import { jsonBody, platformRequest } from "./platformTransport";

export const caseAuthoringApi = {
  catalog: () => platformRequest("/case-authoring/catalog"),
  drafts: (limit = 100) => platformRequest(`/case-authoring/drafts?limit=${limit}`),
  draft: (draftId) => platformRequest(`/case-authoring/drafts/${encodeURIComponent(draftId)}`),
  createDraft: (baseCaseId, caseId = "") => platformRequest("/case-authoring/drafts", {
    method: "POST",
    body: jsonBody({ baseCaseId, ...(caseId ? { caseId } : {}) }),
  }),
  updateModule: (draftId, moduleName, revision, content) => platformRequest(
    `/case-authoring/drafts/${encodeURIComponent(draftId)}/modules/${encodeURIComponent(moduleName)}`,
    { method: "PATCH", body: jsonBody({ revision, content }) },
  ),
  validate: (draftId) => platformRequest(
    `/case-authoring/drafts/${encodeURIComponent(draftId)}/validate`,
    { method: "POST" },
  ),
  submit: (draftId, revision) => platformRequest(
    `/case-authoring/drafts/${encodeURIComponent(draftId)}/submit`,
    { method: "POST", body: jsonBody({ revision }) },
  ),
  review: (draftId, decision, notes) => platformRequest(
    `/case-authoring/drafts/${encodeURIComponent(draftId)}/review`,
    { method: "POST", body: jsonBody({ decision, notes }) },
  ),
  publish: (draftId, version) => platformRequest(
    `/case-authoring/drafts/${encodeURIComponent(draftId)}/publish`,
    { method: "POST", body: jsonBody({ version }) },
  ),
  releases: (limit = 100) => platformRequest(`/case-authoring/releases?limit=${limit}`),
  activate: (releaseId) => platformRequest(
    `/case-authoring/releases/${encodeURIComponent(releaseId)}/activate`,
    { method: "POST" },
  ),
  suggest: (draftId, targetModule, query) => platformRequest(
    `/case-authoring/drafts/${encodeURIComponent(draftId)}/suggestions`,
    { method: "POST", body: jsonBody({ targetModule, query }) },
  ),
};
