import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Checkbox, Input, Select } from "./ui";

afterEach(cleanup);

describe("required field labels", () => {
  it("prefixes every required shared control while preserving its accessible label", () => {
    render(
      <>
        <Input label="Required input" required />
        <Select label="Required select" required>
          <option>Choice</option>
        </Select>
        <Checkbox label="Required checkbox" required />
        <Input label="Optional input" />
      </>
    );

    for (const name of ["Required input", "Required select", "Required checkbox"]) {
      const control = screen.getByLabelText(name);
      expect(control).toBeRequired();
      expect(control.closest("label")?.textContent?.startsWith("*")).toBe(true);
    }

    const optionalControl = screen.getByLabelText("Optional input");
    expect(optionalControl).not.toBeRequired();
    expect(optionalControl.closest("label")?.textContent?.startsWith("*")).toBe(false);
  });
});
