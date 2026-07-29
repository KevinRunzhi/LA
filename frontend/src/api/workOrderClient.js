import { jsonBody, platformRequest } from "./platformTransport";

export const workOrderApi = {
  list(filters = {}) {
    const query = new URLSearchParams(
      Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value != null && value !== ""),
      ),
    );
    return platformRequest(`/work-orders?${query}`);
  },

  create(input) {
    return platformRequest("/work-orders", {
      method: "POST",
      body: jsonBody(input),
    });
  },

  get(orderId) {
    return platformRequest(`/work-orders/${encodeURIComponent(orderId)}`);
  },

  update(orderId, expectedRevision, changes) {
    return platformRequest(`/work-orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: jsonBody({ expectedRevision, ...changes }),
    });
  },

  generateJobCard(orderId) {
    return platformRequest(
      `/work-orders/${encodeURIComponent(orderId)}/job-cards`,
      { method: "POST" },
    );
  },

  jobCards(orderId) {
    return platformRequest(
      `/work-orders/${encodeURIComponent(orderId)}/job-cards`,
    );
  },

  jobCard(documentId) {
    return platformRequest(`/job-cards/${encodeURIComponent(documentId)}`);
  },

  downloadJobCard(documentId) {
    return platformRequest(
      `/job-cards/${encodeURIComponent(documentId)}/download`,
      { responseType: "blob" },
    );
  },
};
