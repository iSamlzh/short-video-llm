import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import HomePage from "../../src/app/page"

describe("prototype workspace", () => {
  it("renders the single content growth workspace", () => {
    render(<HomePage />)
    expect(screen.getByRole("heading", { name: "内容增长 Agent" })).toBeVisible()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })
})
