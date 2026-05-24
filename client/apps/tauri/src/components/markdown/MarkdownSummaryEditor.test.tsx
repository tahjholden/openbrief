import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownSummaryEditor } from "@/components/markdown/MarkdownSummaryEditor";

describe("MarkdownSummaryEditor", () => {
  it("routes custom timestamp markdown links to the caller", async () => {
    const onTimestampClick = vi.fn();
    render(
      <MarkdownSummaryEditor
        markdown="[Replay this point.](#openbrief-timestamp-75)"
        ariaLabel="Summary"
        onTimestampClick={onTimestampClick}
      />,
    );

    fireEvent.click(
      await screen.findByRole("link", { name: "Replay this point." }),
    );

    expect(onTimestampClick).toHaveBeenCalledWith(75);
  });
});
