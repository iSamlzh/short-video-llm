import type { PortraitDimension, QuestionSlot } from "../domain/ip-onboarding"

export type QuestionSlotDefinition = {
  slot: QuestionSlot
  dimension: PortraitDimension
  outputFields: string[]
  topicSignals: string[]
}

const definitions: Array<[QuestionSlot, PortraitDimension]> = [
  ["audience_primary", "target_audience"],
  ["audience_stage", "target_audience"],
  ["audience_urgent_problem", "audience_questions"],
  ["audience_misconception", "audience_questions"],
  ["audience_decision_concern", "audience_questions"],
  ["credibility_experience", "identity_credibility"],
  ["professional_judgement", "identity_credibility"],
  ["distinct_belief", "core_beliefs"],
  ["repeat_principle", "core_beliefs"],
  ["failure_story", "content_assets"],
  ["success_process", "content_assets"],
  ["work_scene", "content_assets"],
  ["existing_assets", "content_assets"],
  ["question_sources", "audience_questions"],
  ["natural_narrative", "presentation_style"],
  ["preferred_structure", "presentation_style"],
  ["opening_style", "presentation_style"],
  ["persona_impression", "identity_credibility"],
  ["product_connection", "commercial_connection"],
  ["service_connection", "commercial_connection"],
  ["non_sales_content", "topic_pillars"],
  ["desired_action", "desired_action"],
  ["undesired_action", "desired_action"],
  ["forbidden_promises", "boundaries"],
  ["private_boundaries", "boundaries"],
  ["misunderstood_expression", "boundaries"],
  ["month_one_topics", "topic_pillars"],
  ["series_topics", "topic_pillars"],
  ["new_direction", "topic_pillars"],
  ["missing_evidence", "content_assets"],
]

export const QUESTION_SLOT_DEFINITIONS: QuestionSlotDefinition[] = definitions.map(([slot, dimension]) => ({
  slot,
  dimension,
  outputFields: [`contentPortrait.${dimension}`],
  topicSignals: [`portrait:${dimension}`],
}))

export function requireQuestionSlot(slot: QuestionSlot) {
  const definition = QUESTION_SLOT_DEFINITIONS.find(item => item.slot === slot)
  if (!definition) throw new Error(`QUESTION_SLOT_NOT_FOUND:${slot}`)
  return definition
}
