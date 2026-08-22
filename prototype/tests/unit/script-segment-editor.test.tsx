import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ScriptSegmentEditor } from "../../src/components/creation/ScriptSegmentEditor"

describe("ScriptSegmentEditor", () => {
  it("明确显示每段类型，并提交修改后的结构化段落", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<ScriptSegmentEditor segments={[
      { id: "segment-1", kind: "spoken", text: "这是一段口播正文。" },
      { id: "segment-2", kind: "shot_instruction", text: "正面机位。" },
    ]} canEdit onSave={save} />)

    expect(screen.getByText("口播")).toBeVisible()
    expect(screen.getByText("拍摄提示")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "编辑第 1 段" }))
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "第 1 段类型" }), "shot_instruction")
    await userEvent.click(screen.getByRole("button", { name: "完成第 1 段编辑" }))

    expect(save).toHaveBeenCalledWith([
      { id: "segment-1", kind: "shot_instruction", text: "这是一段口播正文。" },
      { id: "segment-2", kind: "shot_instruction", text: "正面机位。" },
    ])
  })

  it("系统合规备注不能被普通用户改成口播内容", async () => {
    render(<ScriptSegmentEditor segments={[
      { id: "note-1", kind: "compliance_note", text: "不得承诺收益。" },
    ]} canEdit onSave={vi.fn()} />)

    await userEvent.click(screen.getByRole("button", { name: "编辑第 1 段" }))
    expect(screen.getByRole("combobox", { name: "第 1 段类型" })).toBeDisabled()
    expect(screen.getByText("系统备注类型不可修改")).toBeVisible()
  })
})
