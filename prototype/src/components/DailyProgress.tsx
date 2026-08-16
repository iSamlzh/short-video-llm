const stages = ["确定选题", "选择口播稿", "质量检查", "定稿交接"] as const

function activeStage(state: string) {
  if (["READY_FOR_TOPICS", "GENERATING_TOPICS", "WAITING_TOPIC_SELECTION"].includes(state)) return 0
  if (["READY_FOR_SCRIPTS", "GENERATING_SCRIPTS", "WAITING_SCRIPT_SELECTION"].includes(state)) return 1
  if (["READY_FOR_QA", "RUNNING_QA", "WAITING_LOCK_CONFIRMATION"].includes(state)) return 2
  return 3
}

export function DailyProgress({ state }: { state: string }) {
  const current = activeStage(state)
  return <aside className="daily-progress" aria-label="今日创作进度">
    <p className="progress-title">今日创作</p>
    <ol>{stages.map((stage, index) => <li key={stage} className={index < current ? "done" : index === current ? "active" : undefined} aria-current={index === current ? "step" : undefined}>{stage}</li>)}</ol>
    <p className="progress-note">IP 已在首次使用时完成初始化，日常创作不会重复建档。</p>
  </aside>
}
