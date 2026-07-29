import { jsonBody, platformRequest } from "./platformTransport";

export const graphLifecycleApi = {
  current() {
    return platformRequest("/graph");
  },

  subgraph(centerId, { depth = 1, nodeTypes = [] } = {}) {
    const query = new URLSearchParams({
      centerId,
      depth: String(depth),
      ...(nodeTypes.length ? { nodeTypes: nodeTypes.join(",") } : {}),
    });
    return platformRequest(`/graph/subgraph?${query}`);
  },

  versions(limit = 50) {
    return platformRequest(`/graph/versions?limit=${limit}`);
  },

  version(versionId) {
    return platformRequest(`/graph/versions/${encodeURIComponent(versionId)}`);
  },

  diff(fromVersionId, toVersionId = "") {
    const query = new URLSearchParams({
      fromVersionId,
      ...(toVersionId ? { toVersionId } : {}),
    });
    return platformRequest(`/graph/diff?${query}`);
  },

  changeSets(filters = {}) {
    return platformRequest(`/graph/change-sets?${new URLSearchParams(
      Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value != null && value !== ""),
      ),
    )}`);
  },

  createChangeSet(input) {
    return platformRequest("/graph/change-sets", {
      method: "POST",
      body: jsonBody(input),
    });
  },

  changeSet(changeSetId) {
    return platformRequest(
      `/graph/change-sets/${encodeURIComponent(changeSetId)}`,
    );
  },

  saveItem(changeSetId, input) {
    return platformRequest(
      `/graph/change-sets/${encodeURIComponent(changeSetId)}/items`,
      { method: "POST", body: jsonBody(input) },
    );
  },

  submit(changeSetId) {
    return platformRequest(
      `/graph/change-sets/${encodeURIComponent(changeSetId)}/submit`,
      { method: "POST" },
    );
  },

  review(changeSetId, decision, notes = "") {
    return platformRequest(
      `/graph/change-sets/${encodeURIComponent(changeSetId)}/review`,
      { method: "POST", body: jsonBody({ decision, notes }) },
    );
  },

  publish(changeSetId) {
    return platformRequest(
      `/graph/change-sets/${encodeURIComponent(changeSetId)}/publish`,
      { method: "POST" },
    );
  },
};
