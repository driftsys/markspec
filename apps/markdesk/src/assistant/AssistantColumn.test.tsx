import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AssistantColumn } from "./AssistantColumn";

afterEach(cleanup);

it("shows the set-up message and nothing to interact with", () => {
  const { container } = render(<AssistantColumn />);
  expect(
    screen.getByText(
      "Set up an assistant to ask questions about this product.",
    ),
  ).toBeTruthy();
  expect(container.querySelectorAll("button, input, textarea, a").length)
    .toBe(0);
});
