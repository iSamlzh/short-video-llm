import { QUESTION_SET_VERSION, type IndustryCategory } from "../domain/ip-onboarding"
import { beautySkincareV1 } from "./sets/beauty-skincare"
import { businessServicesV1 } from "./sets/business-services"
import { educationKnowledgeV1 } from "./sets/education-knowledge"
import { fashionStyleV1 } from "./sets/fashion-style"
import { foodFreshV1 } from "./sets/food-fresh"
import { healthWellnessV1 } from "./sets/health-wellness"
import { homeLivingV1 } from "./sets/home-living"
import { localStoreV1 } from "./sets/local-store"
import { maternalParentingV1 } from "./sets/maternal-parenting"
import { otherV1 } from "./sets/other"

const v1Sets = {
  health_wellness: healthWellnessV1,
  beauty_skincare: beautySkincareV1,
  maternal_parenting: maternalParentingV1,
  food_fresh: foodFreshV1,
  home_living: homeLivingV1,
  fashion_style: fashionStyleV1,
  local_store: localStoreV1,
  education_knowledge: educationKnowledgeV1,
  business_services: businessServicesV1,
  other: otherV1,
} as const

const labels: Record<IndustryCategory, string> = {
  health_wellness: "健康养生",
  beauty_skincare: "美容护肤",
  maternal_parenting: "母婴育儿",
  food_fresh: "食品生鲜",
  home_living: "家居日用",
  fashion_style: "服饰穿搭",
  local_store: "本地生活与实体门店",
  education_knowledge: "教育培训与知识服务",
  business_services: "创业经营与商业服务",
  other: "其他",
}

export function getQuestionSet(version: string, industryCategory: IndustryCategory) {
  if (version !== QUESTION_SET_VERSION) throw new Error("QUESTION_SET_VERSION_UNAVAILABLE")
  const set = v1Sets[industryCategory]
  if (!set) throw new Error("INDUSTRY_QUESTION_SET_NOT_FOUND")
  return set
}

export function listIndustryCategories() {
  return (Object.keys(v1Sets) as IndustryCategory[]).map(value => ({ value, label: labels[value] }))
}

export { v1Sets as questionSetsV1 }
