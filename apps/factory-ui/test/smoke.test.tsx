import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("the toolchain renders React in jsdom", () => {
  render(<p>Factory</p>);
  expect(screen.getByText("Factory")).toBeTruthy();
});
