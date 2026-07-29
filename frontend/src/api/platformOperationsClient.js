import { jsonBody, platformRequest } from "./platformTransport";

export const platformOperationsApi = {
  capabilities: () => platformRequest("/system/capabilities", { token: "" }),
  ingestionJobs: (limit = 20) => platformRequest(`/ingestion/jobs?limit=${limit}`),
  createIngestionJob: (sourceRoot = "Info", dryRun = false) => platformRequest(
    "/ingestion/jobs",
    { method: "POST", body: jsonBody({ sourceRoot, dryRun }) },
  ),
  ingestionJob: (jobId) => platformRequest(
    `/ingestion/jobs/${encodeURIComponent(jobId)}`,
  ),
  retryIngestion: (jobId) => platformRequest(
    `/ingestion/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: "POST" },
  ),
  cancelIngestion: (jobId) => platformRequest(
    `/ingestion/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  ),
  unifiedSearch: (query, scope = {}, limit = 12) => platformRequest(
    "/knowledge/search",
    { method: "POST", body: jsonBody({ query, scope, limit }) },
  ),
  searchRuns: (limit = 20) => platformRequest(
    `/knowledge/search-runs?limit=${limit}`,
  ),
  integrityRuns: (limit = 20) => platformRequest(
    `/operations/integrity-runs?limit=${limit}`,
  ),
  runIntegrity: () => platformRequest("/operations/integrity-runs", {
    method: "POST",
  }),
  exportAudit: (format = "csv", filters = {}) => platformRequest(
    "/operations/audit-exports",
    { method: "POST", body: jsonBody({ format, filters }) },
  ),
};
