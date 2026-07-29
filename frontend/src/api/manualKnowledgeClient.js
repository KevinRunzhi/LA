import { jsonBody, platformRequest } from "./platformTransport";

export const manualKnowledgeApi = {
  list(filters = {}) {
    return platformRequest(`/manuals?${new URLSearchParams(compact(filters))}`);
  },

  get(documentId) {
    return platformRequest(`/manuals/${encodeURIComponent(documentId)}`);
  },

  importPdf(file, metadata) {
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    form.append("file", file);
    return platformRequest("/manuals/import", {
      method: "POST",
      body: form,
    });
  },

  search(query, filters = {}) {
    return platformRequest("/manuals/search", {
      method: "POST",
      body: jsonBody({ query, ...filters }),
    });
  },

  reindex(documentId) {
    return platformRequest(
      `/manuals/${encodeURIComponent(documentId)}/reindex`,
      { method: "POST" },
    );
  },

  remove(documentId) {
    return platformRequest(`/manuals/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    });
  },
};

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== "" && item != null),
  );
}
