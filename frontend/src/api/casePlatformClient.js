const PLATFORM_BASE = "/api/platform";

export class CasePlatformError extends Error {
  constructor(message, { code = "request_failed", status = 0, details = {} } = {}) {
    super(message);
    this.name = "CasePlatformError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function idempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function platformRequest(path, options = {}) {
  const response = await fetch(`${PLATFORM_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    ...options,
  });
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.ok) {
    throw new CasePlatformError(
      envelope?.error?.message || `平台请求失败（HTTP ${response.status}）`,
      {
        code: envelope?.error?.code,
        status: response.status,
        details: envelope?.error?.details,
      },
    );
  }
  return envelope.data;
}

function writeBody(actor, expectedRevision, fields = {}) {
  return JSON.stringify({
    actor,
    expectedRevision,
    idempotencyKey: idempotencyKey(),
    ...fields,
  });
}

export const casePlatformApi = {
  listCases: () => platformRequest("/cases"),
  route: (description, context = {}) => platformRequest("/case-routing", {
    method: "POST",
    body: JSON.stringify({ description, context }),
  }),
  createRun: (caseId, actor, input) => platformRequest("/case-runs", {
    method: "POST",
    body: JSON.stringify({
      caseId,
      actor,
      input,
      idempotencyKey: idempotencyKey(),
    }),
  }),
  getRun: (runId, role = "engineer") => (
    platformRequest(`/case-runs/${runId}?role=${encodeURIComponent(role)}`)
  ),
  events: (runId) => platformRequest(`/case-runs/${runId}/events`),
  confirmIntake: (runId, revision, actor, intakeFacts) => platformRequest(
    `/case-runs/${runId}/intake/confirm`,
    { method: "POST", body: writeBody(actor, revision, { intakeFacts }) },
  ),
  diagnose: (runId, revision, actor) => platformRequest(
    `/case-runs/${runId}/diagnosis`,
    { method: "POST", body: writeBody(actor, revision) },
  ),
  confirmPlan: (runId, revision, actor, plan) => platformRequest(
    `/case-runs/${runId}/plan/confirm`,
    {
      method: "POST",
      body: writeBody(actor, revision, plan ? { plan } : {}),
    },
  ),
  startGuide: (runId, revision, actor) => platformRequest(
    `/case-runs/${runId}/guide/start`,
    { method: "POST", body: writeBody(actor, revision) },
  ),
  guideSteps: (runId, role = "engineer") => platformRequest(
    `/case-runs/${runId}/guide/steps?role=${encodeURIComponent(role)}`,
  ),
  completeStep: (runId, stepId, revision, actor, execution) => platformRequest(
    `/case-runs/${runId}/guide/steps/${encodeURIComponent(stepId)}/complete`,
    {
      method: "POST",
      body: writeBody(actor, revision, { execution }),
    },
  ),
  generateRecord: (runId, revision, actor, engineerResult) => platformRequest(
    `/case-runs/${runId}/records/generate`,
    {
      method: "POST",
      body: writeBody(actor, revision, { engineerResult }),
    },
  ),
  submitEngineerResult: (runId, revision, actor) => platformRequest(
    `/case-runs/${runId}/engineer-submit`,
    { method: "POST", body: writeBody(actor, revision) },
  ),
  startExpertReview: (runId, revision, actor) => platformRequest(
    `/case-runs/${runId}/expert/review/start`,
    { method: "POST", body: writeBody(actor, revision) },
  ),
  decideExpertReview: (
    runId,
    revision,
    actor,
    decision,
    expertNotes = {},
  ) => platformRequest(
    `/case-runs/${runId}/expert/review/decision`,
    {
      method: "POST",
      body: writeBody(actor, revision, { decision, expertNotes }),
    },
  ),
  startEngineerRework: (runId, revision, actor, reason = "") => platformRequest(
    `/case-runs/${runId}/engineer-rework/start`,
    {
      method: "POST",
      body: writeBody(actor, revision, { reason }),
    },
  ),
  publishKnowledge: (
    runId,
    revision,
    actor,
    { knowledge, graph, expertNotes } = {},
  ) => platformRequest(
    `/case-runs/${runId}/knowledge/publish`,
    {
      method: "POST",
      body: writeBody(actor, revision, { knowledge, graph, expertNotes }),
    },
  ),
  syncKnowledge: (knowledgeId, actor) => platformRequest(
    `/knowledge/${encodeURIComponent(knowledgeId)}/sync`,
    { method: "POST", body: JSON.stringify({ actor }) },
  ),
  resolveTelemetry: (
    runId,
    actor,
    requestedFields,
    submittedFacts,
  ) => platformRequest(
    `/case-runs/${runId}/telemetry/resolve`,
    {
      method: "POST",
      body: JSON.stringify({ actor, requestedFields, submittedFacts }),
    },
  ),
  searchKnowledge: (runId, actor, stepId, query) => platformRequest(
    `/case-runs/${runId}/assistant/search`,
    { method: "POST", body: JSON.stringify({ actor, stepId, query }) },
  ),
  uploadAttachment: (runId, actor, file, metadata = {}) => {
    const form = new FormData();
    form.append("actorId", actor.id);
    form.append("actorRole", actor.role);
    form.append("metadata", JSON.stringify(metadata));
    form.append("file", file);
    return platformRequest(`/case-runs/${runId}/attachments`, {
      method: "POST",
      body: form,
    });
  },
  attachments: (runId, role = "engineer") => platformRequest(
    `/case-runs/${runId}/attachments?role=${encodeURIComponent(role)}`,
  ),
  reset: (runId, revision, actor) => platformRequest(
    `/case-runs/${runId}/reset`,
    { method: "POST", body: writeBody(actor, revision) },
  ),
};

export class CasePlatformSession {
  constructor(actor, routing, run = null) {
    this.actor = actor;
    this.routing = routing;
    this.run = run;
    this.lastResult = null;
  }

  static async begin(description, actor) {
    const routing = await casePlatformApi.route(description);
    if (routing.routeStatus !== "matched") {
      return new CasePlatformSession(actor, routing);
    }
    const candidate = routing.candidates[0];
    const run = await casePlatformApi.createRun(
      candidate.caseId,
      actor,
      { description, routingDecision: routing },
    );
    return new CasePlatformSession(actor, routing, run);
  }

  get active() {
    return Boolean(this.run);
  }

  async confirmIntake(intakeFacts) {
    this.requireRun();
    this.run = await casePlatformApi.confirmIntake(
      this.run.runId,
      this.run.revision,
      this.actor,
      intakeFacts,
    );
    return this.run;
  }

  async diagnose() {
    this.requireRun();
    const result = await casePlatformApi.diagnose(
      this.run.runId,
      this.run.revision,
      this.actor,
    );
    this.run = result.run;
    this.lastResult = result.diagnosis;
    return result;
  }

  requireRun() {
    if (!this.run) {
      throw new CasePlatformError("当前输入尚未匹配可执行案例", {
        code: this.routing?.routeStatus || "case_not_matched",
      });
    }
  }

  snapshot() {
    return {
      actor: this.actor,
      routing: this.routing,
      run: this.run,
      lastResult: this.lastResult,
    };
  }
}
