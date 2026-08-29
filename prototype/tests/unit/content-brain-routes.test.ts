import { describe, expect, it, vi } from "vitest"
import type { AccessContext, PlatformAccessContext, TenantAccessContext } from "../../src/domain/access"
import { handleContentBrain } from "../../src/app/api/platform/content-brain/[...segments]/route"

const operator: PlatformAccessContext = {
  audience: "platform", userId: "platform-operator", platformRole: "platform_operator",
}
const admin: PlatformAccessContext = {
  audience: "platform", userId: "platform-admin", platformRole: "platform_admin",
}
const tenant: TenantAccessContext = {
  audience: "tenant", userId: "tenant-user", tenantId: "tenant-1", membershipId: "member-1",
  capabilities: ["ip.view"], ipIds: ["ip-1"], contentAccountIds: ["account-1"],
}

describe("平台内容大脑私有路由", () => {
  it("租户会话在仓储读取和请求体读取前被拒绝", async () => {
    const deps = routeDeps()
    let bodyRead = false
    const request = { method: "POST", json: async () => { bodyRead = true; return {} } } as unknown as Request

    const response = await handleContentBrain(request, ["samples"], tenant, deps)

    expect(response.status).toBe(403)
    expect(bodyRead).toBe(false)
    expect(deps.repository.listSamples).not.toHaveBeenCalled()
    expect(deps.samples.createFromText).not.toHaveBeenCalled()
  })

  it("未登录返回 401，平台端点不会暴露内部错误", async () => {
    const response = await handleContentBrain(new Request("http://test/samples"), ["samples"], null, routeDeps())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ errorCode: "UNAUTHENTICATED", message: "请先登录", retryable: false })
  })

  it.each([
    ["POST", ["samples"], { title: "真实售后复盘", sourcePlatform: "视频号", transcript: "这是一段超过四十字的真实样本文本，用于验证爆款拆解工作区的粘贴输入流程和数据保存边界。", rightsNote: "已获授权" }, "samples.createFromText"],
    ["GET", ["samples"], undefined, "repository.listSamples"],
    ["GET", ["sample-queue"], undefined, "repository.listSampleQueue"],
    ["GET", ["samples", "sample-1"], undefined, "repository.getSampleWorkspace"],
    ["POST", ["samples", "sample-1", "analyze"], {}, "analysisJobs.enqueue"],
    ["GET", ["tasks"], undefined, "analysisJobs.list"],
    ["GET", ["tasks", "task-1"], undefined, "analysisJobs.get"],
    ["POST", ["tasks", "task-1", "retry"], {}, "analysisJobs.retry"],
    ["POST", ["tasks", "bulk-retry"], { jobIds: ["00000000-0000-4000-8000-000000000001"] }, "analysisJobs.retryMany"],
    ["PUT", ["analyses", "analysis-1"], { expectedVersion: 1, payload: analysisPayload }, "analysis.saveDraft"],
    ["POST", ["analyses", "analysis-1", "approve"], { expectedVersion: 1, payload: analysisPayload }, "analysis.approveAndPropose"],
    ["POST", ["analyses", "analysis-1", "reject"], { expectedVersion: 1, reason: "证据不足" }, "analysis.rejectAnalysis"],
    ["PUT", ["candidates", "candidate-1"], { expectedVersion: 1, payload: candidatePayload }, "workflow.reviewCandidate"],
    ["POST", ["candidates", "candidate-1", "preview"], { expectedVersion: 1 }, "workflow.previewCandidate"],
    ["POST", ["candidates", "candidate-1", "reject"], { expectedVersion: 1, reason: "泛化不足" }, "workflow.rejectCandidate"],
    ["POST", ["candidates", "candidate-1", "activate"], { expectedVersion: 1, reason: "试生成通过" }, "workflow.activateCandidate"],
    ["POST", ["versions", "version-1", "deactivate"], { reason: "质量复核" }, "workflow.deactivateVersion"],
    ["POST", ["versions", "version-1", "rollback"], { reason: "恢复稳定版本" }, "workflow.rollbackVersion"],
    ["POST", ["structures", "version-1", "evaluate"], {}, "evaluations.evaluate"],
    ["GET", ["evaluations"], undefined, "evaluations.listCurrent"],
    ["GET", ["evaluations", "evaluation-1"], undefined, "evaluations.get"],
    ["POST", ["evaluations", "evaluation-1", "propose"], {}, "evolution.propose"],
    ["GET", ["structures"], undefined, "repository.listActivePackages"],
  ] as const)("%s /%s 调用 %s", async (method, segments, body, callPath) => {
    const deps = routeDeps()
    const response = await handleContentBrain(jsonRequest(method, body), [...segments], callPath.includes("activate") || callPath.includes("deactivate") || callPath.includes("rollback") ? admin : operator, deps)
    const asyncJobRequest = method === "POST" && (segments[0] === "tasks" || segments[2] === "analyze")
    expect(response.status).toBe(method === "POST" && segments.length === 1 && segments[0] === "samples" ? 201 : asyncJobRequest ? 202 : 200)
    const [group, methodName] = callPath.split(".") as [keyof typeof deps, string]
    expect((deps[group] as Record<string, ReturnType<typeof vi.fn>>)[methodName]).toHaveBeenCalledTimes(1)
  })

  it("上传端点读取 multipart 文件并交给样本服务", async () => {
    const deps = routeDeps()
    const file = {
      name: "samples.csv", type: "text/csv",
      arrayBuffer: async () => new TextEncoder().encode("标题,正文\n真实售后,这是满足解析长度要求的一段真实内容文本，用来验证文件上传。").buffer,
    }
    const request = {
      method: "POST",
      formData: async () => ({ get: (key: string) => key === "file" ? file : "已获内部拆解授权" }),
    } as unknown as Request
    const response = await handleContentBrain(request, ["samples", "imports"], operator, deps)
    const responsePayload = await response.clone().json()
    expect(response.status, JSON.stringify(responsePayload)).toBe(201)
    expect(deps.samples.createFromFile).toHaveBeenCalledWith(operator, expect.objectContaining({ filename: "samples.csv", rightsNote: "已获内部拆解授权" }))
  })

  it("样本工作队列解析筛选、日期和游标参数", async () => {
    const deps = routeDeps()
    const request = new Request("http://test/api?queue=failed&q=%E5%94%AE%E5%90%8E&sourcePlatform=wechat_channels&batchId=batch-7&from=2026-08-01&to=2026-08-29&cursor=next-page&limit=25")

    const response = await handleContentBrain(request, ["sample-queue"], operator, deps)

    expect(response.status).toBe(200)
    expect(deps.repository.listSampleQueue).toHaveBeenCalledWith({
      queue: "failed",
      q: "售后",
      sourcePlatform: "wechat_channels",
      batchId: "batch-7",
      createdFrom: "2026-08-01T00:00:00.000Z",
      createdToExclusive: "2026-08-30T00:00:00.000Z",
      cursor: "next-page",
      limit: 25,
    })
  })

  it.each([
    [new Error("CONTENT_SAMPLE_NOT_FOUND"), 404, "CONTENT_SAMPLE_NOT_FOUND", false],
    [new Error("ANALYSIS_VERSION_CONFLICT"), 409, "ANALYSIS_VERSION_CONFLICT", false],
    [Object.assign(new Error("模型调用超时"), { code: "LLM_TIMEOUT", retryable: true }), 504, "LLM_TIMEOUT", true],
  ] as const)("统一映射平台错误", async (error, status, errorCode, retryable) => {
    const deps = routeDeps()
    deps.repository.listSamples.mockImplementation(() => { throw error })
    const response = await handleContentBrain(new Request("http://test/samples"), ["samples"], operator, deps)
    expect(response.status).toBe(status)
    const payload = await response.json()
    expect(payload).toEqual(expect.objectContaining({ errorCode, retryable }))
    expect(JSON.stringify(payload)).not.toContain("stack")
  })

  it("未知字段和未知路由分别返回 400 与 404", async () => {
    const bad = await handleContentBrain(jsonRequest("POST", { unexpected: true }), ["samples", "sample-1", "analyze"], operator, routeDeps())
    expect(bad.status).toBe(400)
    const missing = await handleContentBrain(new Request("http://test/unknown"), ["unknown"], operator, routeDeps())
    expect(missing.status).toBe(404)
  })
})

function jsonRequest(method: string, body?: unknown) {
  return new Request("http://test/api", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json", "idempotency-key": "test-request-12345678" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function routeDeps() {
  return {
    samples: { createFromText: vi.fn(() => ({ id: "sample-1" })), createFromFile: vi.fn(() => []) },
    analysis: {
      analyze: vi.fn(() => ({ id: "analysis-1" })), saveDraft: vi.fn(() => ({ id: "analysis-2" })),
      approveAndPropose: vi.fn(() => ({ id: "candidate-1" })), rejectAnalysis: vi.fn(() => ({ id: "analysis-2" })),
    },
    analysisJobs: {
      enqueue: vi.fn(() => ({ id: "task-1", status: "queued" })), kick: vi.fn(),
      list: vi.fn(() => []), get: vi.fn(() => ({ id: "task-1", status: "running" })),
      retry: vi.fn(() => ({ id: "task-2", status: "queued" })),
      retryMany: vi.fn(() => ({ accepted: 1, jobs: [{ id: "task-2", status: "queued" }] })),
    },
    workflow: {
      reviewCandidate: vi.fn(() => ({ id: "candidate-2" })), previewCandidate: vi.fn(() => ({ id: "preview-1" })),
      rejectCandidate: vi.fn(() => ({ id: "candidate-1" })), activateCandidate: vi.fn(() => ({ id: "version-1" })),
      deactivateVersion: vi.fn(() => ({ id: "version-1" })), rollbackVersion: vi.fn(() => ({ id: "version-1" })),
    },
    repository: {
      listSamples: vi.fn(() => []), getSampleWorkspace: vi.fn(() => ({ id: "sample-1" })),
      listSampleQueue: vi.fn(() => ({ items: [], nextCursor: null, counts: {} })),
      listActivePackages: vi.fn(() => []),
    },
    evaluations: {
      evaluate: vi.fn(() => ({ id: "evaluation-1" })), listCurrent: vi.fn(() => []),
      get: vi.fn(() => ({ id: "evaluation-1" })), evidence: vi.fn(() => []),
    },
    evolution: { propose: vi.fn(() => ({ proposal: { decision: "no_change" }, candidate: null })) },
  } as any
}

const analysisPayload = {
  summary: "用真实冲突建立可信度并落到责任原则。",
  nodes: [{ kind: "hook", instruction: "真实冲突开场", required: true, evidenceRefs: ["e1"] }],
  reusablePatterns: ["冲突—处理—原则"], nonReusableFacts: ["具体姓名"],
  applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
  riskNotes: ["不得承诺收益"],
  evidenceRefs: [{ id: "e1", quote: "真实售后冲突", start: 1, end: 7 }],
  suggestedDecision: "create_new",
}

const candidatePayload = {
  decision: "create_new", targetTemplateId: null, name: "真实冲突—责任原则",
  applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
  nodes: [{ kind: "hook", instruction: "用可核验冲突开场", required: true }],
  qualityRules: ["包含处理动作"], riskRules: ["不得承诺收益"],
  similarities: [], differences: ["新增责任原则"], confidence: "medium",
}
