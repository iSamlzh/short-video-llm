import type { LlmAdapter, LlmRequest, LlmResponse, TokenUsage } from "./adapter"

type ResponseMetadata = { model?: string; usage?: TokenUsage }
type QueuedResponse = ({ text: string } | { json: unknown }) & ResponseMetadata

export class FakeLlmAdapter implements LlmAdapter {
  readonly calls: LlmRequest[] = []
  private readonly queue: QueuedResponse[]

  constructor(responses: QueuedResponse[] = []) { this.queue = [...responses] }
  enqueue(response: QueuedResponse) { this.queue.push(response) }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request)
    const response = this.queue.shift()
    if (!response) throw new Error(`FAKE_LLM_RESPONSE_MISSING:${request.operation}`)
    return {
      text: "json" in response ? JSON.stringify(response.json) : response.text,
      model: response.model ?? "fake-test-model",
      usage: response.usage,
    }
  }
}

export class PrototypeFixtureLlmAdapter implements LlmAdapter {
  readonly calls: LlmRequest[] = []
  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request)
    const input = request.input as Record<string, any>
    const displayName = String(input.displayName ?? "").trim() || input.ipProfile?.displayName || "当前 IP"
    const portraitAnswers = Array.isArray(input.answers) ? input.answers as Array<Record<string, any>> : []
    const firstAnswer = (dimension: string) => portraitAnswers.find(answer => answer.dimension === dimension)
    const answerText = (dimension: string, fallback: string) => {
      const value = firstAnswer(dimension)?.value
      return Array.isArray(value) ? value.join("、") : String(value ?? fallback)
    }
    const answerId = (dimension: string) => String(
      firstAnswer(dimension)?.questionId ?? portraitAnswers[0]?.questionId ?? "fixture-q01",
    )
    const ipPortrait = {
      contentPortrait: {
        schemaVersion: 1,
        questionSetVersion: String(input.questionSetVersion ?? "ip-question-bank-v1"),
        industryCategory: String(input.industryCategory ?? "other"),
        identityPositioning: `${displayName}基于真实经历分享可执行的内容判断`,
        credibilitySources: [answerText("identity_credibility", "已确认的一线经历")],
        targetAudience: answerText("target_audience", "需要这类经验的人"),
        audienceQuestions: [answerText("audience_questions", "受众正在面对的具体问题")],
        coreBeliefs: [answerText("core_beliefs", "只讲有事实依据的判断")],
        contentAssets: [answerText("content_assets", "已确认的真实素材")],
        presentationStyles: [answerText("presentation_style", "真实问答")],
        commercialConnections: [answerText("commercial_connection", "用知识自然连接产品或服务")],
        desiredActions: [answerText("desired_action", "关注并继续了解")],
        boundaries: [answerText("boundaries", "不作无法证实的承诺")],
        topicPillars: [{
          title: "从受众真实问题出发的长期内容",
          rationale: "同时匹配目标受众和高频问题",
          sourceQuestionIds: [answerId("target_audience"), answerId("audience_questions")],
        }],
        confirmedFacts: [{
          statement: answerText("identity_credibility", "已有真实一线经历"),
          sourceQuestionIds: [answerId("identity_credibility")],
        }],
        uncertainties: [],
        sourceMap: {
          identityPositioning: [answerId("identity_credibility")],
          targetAudience: [answerId("target_audience")],
          audienceQuestions: [answerId("audience_questions")],
          contentAssets: [answerId("content_assets")],
          boundaries: [answerId("boundaries")],
        },
      },
      portrait: {
        headline: `我理解的${displayName}：把真实经营经验讲给需要的人`,
        name: displayName,
        title: "本地生意与社区经营",
        identity: `${answerText("identity_credibility", "长期参与一线业务")}，这是用户确认的真实经历。`,
        authority: "以真实经历、具体场景和可执行方法建立信任。",
        audience: answerText("target_audience", "需要这类经验的人"),
        boundaries: [answerText("boundaries", "不作无法证实的承诺")],
        directions: ["真实经营现场", "选品判断", "长期信任"],
        source: `来源于${portraitAnswers.length}条已确认建档回答`,
        verifiedFacts: [answerText("identity_credibility", "已有真实一线经历")],
        uncertainFact: "暂无需要额外确认的信息",
        account: `视频号｜${displayName}聊经营`,
      },
      profile: {
        displayName,
        experience: `${answerText("identity_credibility", "长期参与一线业务")}，并积累了可用于内容创作的真实经验。`,
        expertise: "本地生意与社区经营",
        audience: answerText("target_audience", "需要这类经验的人"),
        voiceStyle: answerText("presentation_style", "直接、真诚、讲具体动作"),
        boundaries: answerText("boundaries", "不作无法证实的承诺"),
      },
      account: { platform: input.primaryPlatform ?? "wechat_channels", name: `${displayName}聊经营` },
    }
    const topics = Array.from({ length: 3 }, (_, index) => ({
      id: `topic-${index + 1}`, title: ["把踩过的坑变成信任", "新团长最容易误判的三件事", "我为什么不承诺确定收益"][index],
      angle: "从三年社区团购的真实经历切入，给目标受众一个今天能采用的方法",
      audienceTension: "想拓展本地业务，但害怕选错方法",
      ipFitEvidence: [input.ipProfile?.experience ?? "真实业务经历"],
      structureId: ["failure-turn", "myth-correction", "value-filter"][index], riskNotes: [],
    }))
    const selectedTopic = input.selectedTopic ?? topics[0]
    const scripts = Array.from({ length: 3 }, (_, index) => ({
      id: `script-${index + 1}`, topicDirectionId: selectedTopic.id,
      title: index === 0 ? (request.operation === "topic_draft" ? `${selectedTopic.title}：今天这样讲` : "真正难的不是找货，是让邻居愿意一直信你") : `同方向表达路径 ${index + 1}`,
      hook: ["大家好，我是林姐，在小区做团长七年了。很多人问我，做团购最难的是什么？后来才发现，真正难的不是找货，是让邻居愿意一直信你。", "新团长别急着追求规模", "真正能长期合作的人，会先问这件事"][index],
      body: index === 0 ? "我刚开始做团的时候，也踩过不少坑。有一次，为了凑单，我上了一个自己都没吃过的零食，结果口感一般。邻居的一句话让我挺心虚。从那以后，我给自己定了三条底线：不熟悉的不推，不确定的不推，口碑不稳定的不推。\n\n这几年，我慢慢摸出一套自己的选品办法。第一，先试吃、试用，自己满意才发；第二，看最近一个月的真实反馈；第三，考虑邻居的真实场景。我不追爆款，只做合适的好货。\n\n信任不是靠一单建立的，是靠一次次把小事做好。坏果包赔不拖，售后亲自盯，有问题先承担，再复盘改进。邻居说跟着林姐买心里踏实，这句话比什么都重要。" : `这是围绕唯一方向的第 ${index + 1} 种完整表达。我会从自己的社区团购经历讲起，把当时的判断、踩过的坑和后来验证有效的动作说明白，让听众获得可以结合自身情况使用的方法，而不是一个无法核实的收益承诺。`,
      callToAction: index === 0 ? "如果你也在做团长，记住：货可以贵一点，但人品一定要贵。把邻居当朋友，把团购当长期的事，你会走得更稳、更远。" : "如果你也在做本地业务，可以留言说说你的具体情况。", estimatedSeconds: index === 0 ? 130 : 75,
    }))
    const qualityReport = {
      hardGatePassed: true, hardGateReasons: [],
      scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 },
      suggestions: ["拍摄时在中段补充一个可核实的具体动作"],
    }
    const contentAnalysis = {
      summary: "真实冲突进入，处理过程建立可信度，最后落到责任原则。",
      nodes: [
        { kind: "hook", instruction: "以真实冲突开场", required: true, evidenceRefs: ["e1"] },
        { kind: "principle", instruction: "落到责任原则", required: true, evidenceRefs: ["e2"] },
      ],
      reusablePatterns: ["冲突—处理—原则"], nonReusableFacts: ["具体人物姓名"],
      applicability: {
        ipTags: ["社区团购选品、社群维护与团长培训"],
        audiences: ["想做本地生意的宝妈和小店主"],
        goals: ["团长招商获客"],
      },
      riskNotes: ["不得承诺收益"],
      evidenceRefs: [
        { id: "e1", quote: "真实经历", start: 0, end: 4 },
        { id: "e2", quote: "责任原则", start: 5, end: 9 },
      ],
      suggestedDecision: "create_new",
    }
    const structureCandidate = {
      decision: "create_new", targetTemplateId: null, name: "真实冲突—责任原则",
      applicability: contentAnalysis.applicability,
      nodes: contentAnalysis.nodes.map(({ evidenceRefs: _evidenceRefs, ...node }) => node),
      qualityRules: ["必须包含具体处理动作"], riskRules: ["不得承诺收益"],
      similarities: [], differences: ["新增责任原则节点"], confidence: "medium",
    }
    const structurePreview = {
      topic: "一次售后如何建立长期信任",
      script: "从一次真实售后冲突讲起，说明核验、承担和处理动作，最后落到长期责任原则。",
      nodeMappings: [{ node: "真实冲突", excerpt: "一次真实售后冲突" }],
      qualityChecks: [{ rule: "包含具体处理动作", passed: true }],
      riskChecks: [{ rule: "不得承诺收益", passed: true }],
    }
    const payload = request.operation === "ip_portrait" ? ipPortrait : request.operation === "topics" ? topics : request.operation === "scripts" ? scripts : request.operation === "qa" ? qualityReport : request.operation === "auto_draft" ? {
      topics, selectedTopicId: topics[0].id, scripts, selectedScriptId: scripts[0].id, qualityReport,
    } : request.operation === "topic_draft" ? {
      scripts, selectedScriptId: scripts[0].id, qualityReport,
    } : request.operation === "review" ? {
      summary: "本轮模拟结果用于验证从创作到复盘的完整交互。",
      keep: ["真实经历与选题方向保持一致"], improve: ["下一稿可让开头更快进入受众矛盾"],
      nextContent: "继续沿当前方向拆解一个真实场景中的判断过程。",
      evidenceLimits: "指标全部来自确定性模拟器，不代表平台真实表现，也不能证明因果。",
      claimsRealCausation: false,
    } : request.operation === "real_review" ? {
      headline: "真实场景内容值得继续验证",
      observations: [{
        text: "当前样本中的真实场景内容表现较稳定",
        evidenceSnapshotIds: [input.evidence?.[0]?.snapshotId].filter(Boolean),
      }],
      hypotheses: [], keep: ["真实人物与具体场景"], avoid: ["无证据的因果结论"],
      nextContentSignals: ["继续验证同类真实场景"],
      evidenceLimits: "当前数据只表达账号内相关性，不能证明平台分发或选题因果。",
    } : request.operation === "content_analysis" ? contentAnalysis
      : request.operation === "structure_candidate" ? structureCandidate
        : request.operation === "structure_preview" ? structurePreview
          : (() => { throw new Error(`UNEXPECTED_FIXTURE_OPERATION:${request.operation}`) })()
    return { text: JSON.stringify(payload), model: "prototype-e2e-fixture" }
  }
}
