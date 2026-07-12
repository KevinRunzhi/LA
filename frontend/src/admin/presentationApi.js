const JSON_HEADERS = { "Content-Type": "application/json" };

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, { headers: JSON_HEADERS, signal: controller.signal, ...options });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.message || `请求失败：${response.status}`);
    return payload.data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("后端服务响应超时，请确认 Flask 服务已启动后重试");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const presentationApi = {
  state: () => request("/api/presentation/state"),
  reset: () => request("/api/presentation/reset", { method: "POST", body: "{}" }),
  switchRole: (role) => request("/api/presentation/role", { method: "POST", body: JSON.stringify({ role }) }),
  users: () => request("/api/admin/users"),
  cases: () => request("/api/admin/cases"),
  caseDetail: (id) => request(`/api/admin/cases/${id}`),
  adoptEngineerResult: (id) => request(`/api/admin/cases/${id}/adopt-engineer-result`, { method: "POST", body: "{}" }),
  submitCase: (id, engineerResult) => request(`/api/admin/cases/${id}/submit`, { method: "POST", body: JSON.stringify({ engineerResult }) }),
  adoptExpertConclusion: (id) => request(`/api/admin/cases/${id}/adopt-expert-conclusion`, { method: "POST", body: "{}" }),
  graphDecision: (id, decision) => request(`/api/admin/cases/${id}/graph-decision`, { method: "POST", body: JSON.stringify({ decision }) }),
  saveExpertDraft: (id, expertDraft) => request(`/api/admin/cases/${id}/expert-draft`, { method: "POST", body: JSON.stringify({ expertDraft }) }),
  publishCase: (id, expertDraft) => request(`/api/admin/cases/${id}/publish`, { method: "POST", body: JSON.stringify({ expertDraft }) }),
  knowledge: () => request("/api/admin/knowledge"),
  knowledgeDetail: (id) => request(`/api/admin/knowledge/${id}`),
  knowledgeDiff: (id) => request(`/api/admin/knowledge/${id}/diff`),
  verify: (input) => request("/api/knowledge/verify-feedback", { method: "POST", body: JSON.stringify({ input }) }),
  engineerSyncStatus: () => request("/api/engineer/knowledge-sync"),
  engineerSyncLatest: () => request("/api/engineer/knowledge-sync", { method: "POST", body: "{}" }),
  engineerSnapshot: () => request("/api/engineer/knowledge-snapshot"),
};
