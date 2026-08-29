import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { MetricsRepository } from "../../src/lib/db/metrics-repository"
import { seedDemoData } from "../../src/scripts/demo-data"
import { StructureObservationProjector } from "../../src/services/structure-observation-projector"

describe("结构观测可靠回流", () => {
  let database: Database.Database
  let metrics: MetricsRepository

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    metrics = new MetricsRepository(database)
    seedLineageAndMetrics(database)
  })

  afterEach(() => database.close())

  it("匹配成功后由 Outbox 生成不含租户身份的匿名结构观测", () => {
    const snapshot = metrics.requireSnapshot("observation-snapshot")
    metrics.appendMatch({
      id: "observation-match-1", snapshot, publicationId: "observation-publication-system",
      candidateIds: [], method: "exact_video_id", status: "matched", explanation: "测试精确匹配",
      version: 1, createdAt: "2026-08-29T08:00:00.000Z",
    })

    expect(new StructureObservationProjector(database).processPending()).toMatchObject({ completed: 1, failed: 0 })
    const observation = database.prepare("SELECT * FROM platform_structure_observations").get() as Record<string, unknown>
    expect(observation.structure_version_id).toBe("observation-template-v1")
    expect(JSON.parse(String(observation.node_keys_json))).toEqual(["hook-trust"])
    expect(JSON.parse(String(observation.metrics_json))).toMatchObject({ plays: 1200, completionRate: 0.42 })
    expect(observation.status).toBe("active")
    const columns = (database.prepare("PRAGMA table_info(platform_structure_observations)").all() as Array<{ name: string }>).map((item) => item.name)
    expect(columns).not.toEqual(expect.arrayContaining([
      "tenant_id", "ip_profile_id", "content_account_id", "publication_id", "script_text",
    ]))
  })

  it("人工改绑到外部作品时通过补偿事件撤回旧结构观测", () => {
    const snapshot = metrics.requireSnapshot("observation-snapshot")
    metrics.appendMatch({
      id: "observation-match-1", snapshot, publicationId: "observation-publication-system",
      candidateIds: [], method: "exact_video_id", status: "matched", explanation: "初次匹配",
      version: 1, createdAt: "2026-08-29T08:00:00.000Z",
    })
    const projector = new StructureObservationProjector(database)
    projector.processPending()
    metrics.appendMatch({
      id: "observation-match-2", snapshot, publicationId: "observation-publication-external",
      candidateIds: [], method: "manual_existing", status: "matched", explanation: "人工更正",
      version: 2, createdAt: "2026-08-29T08:05:00.000Z",
    })
    projector.processPending()

    expect(database.prepare("SELECT status FROM platform_structure_observations").get()).toEqual({ status: "invalidated" })
    expect(database.prepare(`SELECT COUNT(*) count FROM domain_outbox_events WHERE status='completed'`).get())
      .toEqual({ count: 3 })
  })
})

function seedLineageAndMetrics(database: Database.Database) {
  const now = "2026-08-29T07:00:00.000Z"
  database.prepare(`INSERT INTO platform_template_versions
    (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
    VALUES ('observation-template-v1','observation-template',1,'信任钩子','{}','active',0,'formal','user-platform',?,?)`)
    .run(now, now)
  database.prepare(`INSERT INTO runs
    (id,state,input_version,schema_version,ip_profile_json,created_at,updated_at)
    VALUES ('observation-run','LOCKED',1,1,'{}',?,?)`).run(now, now)
  database.prepare(`INSERT INTO locked_scripts
    (run_id,version,schema_version,sha256,payload_json,created_at,script_selection_version)
    VALUES ('observation-run',1,1,'hash','{}',?,1)`).run(now)
  database.prepare(`INSERT INTO structure_usage_records
    (id,run_id,locked_script_version,tenant_id,ip_profile_id,content_account_id,
     primary_structure_version_id,supporting_structure_version_ids_json,attribution_status,created_at)
    VALUES ('observation-usage','observation-run',1,'tenant-linjie','ip-linjie','account-linjie-wechat',
      'observation-template-v1','[]','attributed',?)`).run(now)
  database.prepare(`INSERT INTO structure_usage_nodes
    (id,usage_id,template_version_id,node_key,segment_id,segment_kind,position,created_at)
    VALUES ('observation-node','observation-usage','observation-template-v1','hook-trust','segment-1','spoken',0,?)`).run(now)
  const publication = database.prepare(`INSERT INTO publications
    (id,tenant_id,ip_profile_id,content_account_id,platform,source,run_id,locked_script_version,
     locked_script_selection_version,title,platform_video_id,published_at,status,created_by_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  publication.run("observation-publication-system", "tenant-linjie", "ip-linjie", "account-linjie-wechat", "wechat_channels",
    "system", "observation-run", 1, 1, "系统作品", "system-video", now, "active", "user-owner", now)
  publication.run("observation-publication-external", "tenant-linjie", "ip-linjie", "account-linjie-wechat", "wechat_channels",
    "external", null, null, null, "外部作品", "external-video", now, "active", "user-owner", now)
  database.prepare(`INSERT INTO metric_import_batches
    (id,tenant_id,ip_profile_id,content_account_id,platform,filename,file_sha256,status,total_rows,
     inserted_rows,created_by_user_id,created_at,updated_at)
    VALUES ('observation-batch','tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',
      'metrics.csv','observation-hash','parsed',1,1,'user-owner',?,?)`).run(now, now)
  database.prepare(`INSERT INTO real_metric_snapshots
    (id,tenant_id,ip_profile_id,content_account_id,platform,platform_content_key,platform_video_id,title,
     published_at,captured_at,plays,completion_rate,likes,comments,saves,shares,inquiries,is_simulated,
     source_batch_id,source_row_number,created_at)
    VALUES ('observation-snapshot','tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',
      'observation-key','system-video','系统作品',?,?,1200,0.42,80,12,30,9,4,0,'observation-batch',1,?)`)
    .run(now, "2026-08-29T08:00:00.000Z", now)
}
