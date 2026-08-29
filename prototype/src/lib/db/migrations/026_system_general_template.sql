CREATE TABLE IF NOT EXISTS platform_template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','inactive')),
  is_general INTEGER NOT NULL DEFAULT 0,
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  UNIQUE(template_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_template
  ON platform_template_versions(template_id) WHERE status = 'active';

INSERT OR IGNORE INTO platform_template_versions (
  id,
  template_id,
  version,
  name,
  payload_json,
  status,
  is_general,
  data_origin,
  created_by_user_id,
  created_at,
  activated_at
) VALUES (
  'system-general-content-v1',
  'system-general-content',
  1,
  '通用：真实场景—判断转折—行动方法',
  '{"applicability":{"ipTags":[],"audiences":[],"goals":[]},"nodes":[{"nodeKey":"real-scene","kind":"hook","instruction":"用与选题直接相关的真实场景、具体问题或受众困惑开场，不虚构经历","required":true},{"nodeKey":"key-judgement","kind":"insight","instruction":"给出基于 IP 真实经验的核心判断，说明常见误区或认知转折","required":true},{"nodeKey":"action-method","kind":"method","instruction":"拆成二至三个可理解、可执行的动作或判断标准","required":true},{"nodeKey":"boundary-close","kind":"close","instruction":"说明适用边界并自然收束，引导受众完成一个低门槛行动","required":true}],"qualityRules":["内容必须与当前 IP 已确认画像一致","至少包含一个具体场景和一个可执行动作","口播表达自然，避免空泛说教"],"riskRules":["不得虚构案例、资历或数据","不得承诺收益、疗效或确定性结果","涉及专业领域时必须保留适用边界"]}',
  'active',
  1,
  'formal',
  'system',
  '2026-08-29T12:00:00.000Z',
  '2026-08-29T12:00:00.000Z'
);
