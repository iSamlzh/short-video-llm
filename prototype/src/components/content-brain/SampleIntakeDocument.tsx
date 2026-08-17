"use client"

import { useRef, useState } from "react"
import { FileArrowUp, TextAlignLeft, X } from "@phosphor-icons/react"
import type { ContentBrainApi, SampleWorkspace } from "./types"

export function SampleIntakeDocument({ api, onCompleted, onCancel }: {
  api: ContentBrainApi
  onCompleted: (workspace: SampleWorkspace, duplicate: boolean) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<"paste" | "file">("paste")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)
    try {
      const form = new FormData(event.currentTarget)
      let sampleId: string
      let duplicate = false
      if (mode === "file") {
        const file = fileRef.current?.files?.[0]
        if (!file) throw new Error("请选择要导入的文件")
        const rows = await api.importSamples(file, String(form.get("rightsNote") ?? ""))
        if (!rows[0]) throw new Error("文件中没有可用样本")
        sampleId = rows[0].sampleId
        duplicate = Boolean(rows[0].duplicate)
      } else {
        const created = await api.createSample({
          title: form.get("title"), sourcePlatform: form.get("sourcePlatform"),
          transcript: form.get("transcript"), rightsNote: form.get("rightsNote"),
          sourceUrl: null,
        })
        sampleId = created.sampleId
        duplicate = Boolean(created.duplicate)
      }
      await api.analyze(sampleId)
      onCompleted(await api.getSample(sampleId), duplicate)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "样本处理失败，请重试")
    } finally {
      setPending(false)
    }
  }

  return <form className="brain-intake-document" onSubmit={submit}>
    <header className="brain-document-heading">
      <div><h1>新增爆款样本</h1><p>提供已授权的真实内容，Agent 会拆解证据、结构和适用边界。</p></div>
      <button className="brain-icon-button" type="button" aria-label="关闭新增样本" onClick={onCancel}><X size={20} /></button>
    </header>
    <div className="brain-mode-switch" aria-label="样本录入方式">
      <button type="button" aria-pressed={mode === "paste"} onClick={() => setMode("paste")}><TextAlignLeft size={19} />粘贴原文</button>
      <button type="button" aria-pressed={mode === "file"} onClick={() => setMode("file")}><FileArrowUp size={19} />导入文件</button>
    </div>
    {mode === "paste" ? <div className="brain-form-grid">
      <label>样本标题<input name="title" required minLength={2} /></label>
      <label>来源平台<select name="sourcePlatform" defaultValue="wechat_channels"><option value="wechat_channels">视频号</option><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="other">其他</option></select></label>
      <label className="brain-field-wide">口播原文<textarea name="transcript" required minLength={40} rows={12} placeholder="粘贴完整口播原文，不要只填标题或摘要。" /></label>
    </div> : <label className="brain-file-drop">导入样本文件<input ref={fileRef} name="file" type="file" required accept=".txt,.srt,.vtt,.csv,.xlsx" /><span>支持 TXT、SRT、VTT、CSV、XLSX，单个文件不超过 5 MB。</span></label>}
    <label className="brain-rights-field">授权说明<textarea name="rightsNote" required minLength={2} rows={3} placeholder="说明内容来源和内部拆解授权范围。" /></label>
    {error && <p className="brain-inline-error" role="alert">{error}</p>}
    <footer className="brain-document-actions">
      <button type="button" className="brain-button-secondary" onClick={onCancel}>取消</button>
      <button type="submit" className="brain-button-primary" disabled={pending}>{pending ? "正在拆解内容" : "保存并开始拆解"}</button>
    </footer>
  </form>
}
