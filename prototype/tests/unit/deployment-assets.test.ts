import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("单机生产部署资产", () => {
  it("systemd 只启动一个应用实例并在异常退出后重启", () => {
    const unit = readFileSync("deploy/systemd/content-agent.service", "utf8")
    expect(unit).toMatch(/ExecStart=.*next start|ExecStart=.*npm run start/)
    expect(unit).toContain("Restart=on-failure")
    expect(unit).toContain("TimeoutStopSec=30s")
    expect(unit).toContain("ReadWritePaths=/var/lib/content-agent")
    expect(unit).toContain("StandardOutput=append:/var/log/content-agent/app-access.jsonl")
    expect(unit).toContain("StandardError=append:/var/log/content-agent/app-error.jsonl")
    expect(unit).not.toMatch(/pm2|cluster|replicas/i)
  })

  it("Nginx 强制 HTTPS、限制 10MB 上传并为模型调用保留总超时", () => {
    const nginx = readFileSync("deploy/nginx/content-agent.conf", "utf8")
    expect(nginx).toContain("return 301 https://$host$request_uri")
    expect(nginx).toContain("client_max_body_size 10m")
    expect(nginx).toContain("proxy_read_timeout 180s")
    expect(nginx).toContain("Strict-Transport-Security")
    expect(nginx).toContain("limit_req zone=content_agent_login")
    expect(nginx).toContain("proxy_set_header X-Request-Id $request_id")
    expect(nginx).toContain("nginx-exception.jsonl")
  })

  it("备份走 SQLite 在线 backup，恢复脚本不提供覆盖生产库的路径", () => {
    const maintenance = readFileSync("deploy/scripts/sqlite-maintenance.mjs", "utf8")
    const restore = readFileSync("deploy/scripts/restore-sqlite.sh", "utf8")
    expect(maintenance).toContain("await source.backup")
    expect(maintenance).toContain("PRODUCTION_OVERWRITE_FORBIDDEN")
    expect(maintenance).toContain("TARGET_DIRECTORY_IS_PRODUCTION_DIRECTORY")
    expect(maintenance).not.toMatch(/copyFileSync\(sourcePath/)
    expect(restore).toContain("--production-db")
  })

  it("正常日志保留 14 天，异常日志保留 90 天并由 logrotate 定时清理", () => {
    const policy = readFileSync("deploy/logrotate/content-agent", "utf8")
    const sections = policy.split(/\n}\n/)

    expect(sections[0]).toContain("app-access.jsonl")
    expect(sections[0]).toMatch(/rotate 14/)
    expect(sections[0]).toMatch(/maxage 14/)
    expect(sections[1]).toContain("app-error.jsonl")
    expect(sections[1]).toMatch(/rotate 90/)
    expect(sections[1]).toMatch(/maxage 90/)
    expect(policy).toContain("compress")
  })

  it("发布健康检查允许应用冷启动，但等待时间有明确上限", () => {
    const smokeTest = readFileSync("deploy/scripts/smoke-test.sh", "utf8")
    expect(smokeTest).toContain("seq 1 30")
    expect(smokeTest).toContain("--max-time 2")
    expect(smokeTest).toContain("应用在 30 秒内未通过存活检查")
  })
})
