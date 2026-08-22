import { FormEvent, useState } from "react"
import type { IndustryCategory } from "../../domain/ip-onboarding"
import type { IpBasicInfo } from "./IpBasicInfoStep"

const categories: Array<{ value: IndustryCategory; label: string; note: string }> = [
  { value: "health_wellness", label: "健康养生", note: "健康管理、滋补与日常养护" },
  { value: "beauty_skincare", label: "美容护肤", note: "护肤、美妆与个人护理" },
  { value: "maternal_parenting", label: "母婴育儿", note: "孕产、育儿与家庭成长" },
  { value: "food_fresh", label: "食品生鲜", note: "食品、餐饮与生鲜选品" },
  { value: "home_living", label: "家居日用", note: "居家、清洁与生活方式" },
  { value: "fashion_style", label: "服饰穿搭", note: "服装、配饰与审美表达" },
  { value: "local_store", label: "本地生活与实体门店", note: "门店经营与本地服务" },
  { value: "education_knowledge", label: "教育培训与知识服务", note: "课程、咨询与知识内容" },
  { value: "business_services", label: "创业经营与商业服务", note: "经营方法与企业服务" },
  { value: "other", label: "其他", note: "暂未归入以上行业" },
]

export function IndustryCategoryStep({ basicInfo, busy, onBack, onStart }: {
  basicInfo: IpBasicInfo
  busy: boolean
  onBack(): void
  onStart(industryCategory: IndustryCategory): void
}) {
  const [selected, setSelected] = useState<IndustryCategory | null>(null)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (selected) onStart(selected)
  }
  return <form className="onboarding-sheet industry-step" onSubmit={submit}>
    <p className="onboarding-kicker">{basicInfo.displayName} · 选择内容行业</p>
    <h1>你准备长期讲哪个行业</h1>
    <p className="onboarding-intro-copy">行业必须由你确认。首版只做行业级问题，不给你贴过细的专业标签。</p>
    <fieldset className="industry-options"><legend className="sr-only">选择行业</legend>
      {categories.map(category => <label key={category.value} className={selected === category.value ? "industry-option is-selected" : "industry-option"}>
        <input aria-label={category.label} type="radio" name="industry" value={category.value} checked={selected === category.value} onChange={() => setSelected(category.value)} />
        <span><strong>{category.label}</strong><small>{category.note}</small></span>
      </label>)}
    </fieldset>
    {(!selected || busy) && <span className="sr-only" id="industry-submit-hint">{busy ? "正在建立问题路径" : "请先选择一个行业"}</span>}
    <div className="onboarding-actions"><button type="button" className="text-button" onClick={onBack}>返回修改</button><button className="primary-button" type="submit" disabled={!selected || busy} aria-describedby={!selected || busy ? "industry-submit-hint" : undefined}>{busy ? "正在建立问题路径…" : "开始建立内容画像"}</button></div>
  </form>
}
