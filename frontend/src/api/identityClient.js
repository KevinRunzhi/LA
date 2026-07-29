import {
  jsonBody,
  loadPlatformSession,
  platformRequest,
  savePlatformSession,
} from "./platformTransport";

export const identityApi = {
  async login(account, password) {
    const session = await platformRequest("/auth/login", {
      method: "POST",
      token: "",
      clearSessionOnUnauthorized: false,
      body: jsonBody({ account, password }),
    });
    savePlatformSession(session);
    return session;
  },

  async me() {
    const user = await platformRequest("/auth/me");
    const session = loadPlatformSession();
    if (session) savePlatformSession({ ...session, user });
    return user;
  },

  async logout() {
    try {
      return await platformRequest("/auth/logout", { method: "POST" });
    } finally {
      savePlatformSession(null);
    }
  },

  listUsers(filters = {}) {
    return platformRequest(`/admin/users?${new URLSearchParams(
      compactQuery(filters),
    )}`);
  },

  createUser(input) {
    return platformRequest("/admin/users", {
      method: "POST",
      body: jsonBody(input),
    });
  },

  updateUser(userId, changes) {
    return platformRequest(`/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: jsonBody(changes),
    });
  },

  resetPassword(userId, newPassword) {
    return platformRequest(
      `/admin/users/${encodeURIComponent(userId)}/password`,
      {
        method: "POST",
        body: jsonBody({ newPassword }),
      },
    );
  },

  auditEvents(filters = {}) {
    return platformRequest(`/admin/audit-events?${new URLSearchParams(
      compactQuery(filters),
    )}`);
  },
};

function compactQuery(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== "" && item != null),
  );
}
