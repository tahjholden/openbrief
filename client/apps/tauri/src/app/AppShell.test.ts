import { describe, expect, it, vi } from "vitest";
import { createCompletedImportNotice } from "@/app/AppShell";
import type { IngestJob } from "@/domain/media-library";
import { translate, type TranslationKey } from "@/i18n";

function t(
  key: TranslationKey,
  values?: Record<string, string | number | undefined>,
) {
  return translate("en-US", key, values);
}

describe("createCompletedImportNotice", () => {
  it("opens completed imports in the note view from the toast action", () => {
    const onOpenMedia = vi.fn();
    const onDismiss = vi.fn();
    const job: IngestJob = {
      id: "ingest-youtube-video",
      sourceKind: "youtube",
      status: "completed",
      progressPercent: 100,
      videoId: "youtube-video",
      originalUri: "https://www.youtube.com/watch?v=U_Ia9xKL0vI",
      title: "https://www.youtube.com/watch?v=U_Ia9xKL0vI",
    };

    const notice = createCompletedImportNotice({
      job,
      t,
      onOpenMedia,
      onDismiss,
    });

    expect(notice).toMatchObject({
      message: "Imported https://www.youtube.com/watch?v=U_Ia9xKL0vI",
      action: { label: "Open" },
    });

    if (typeof notice === "string") {
      throw new Error("expected completed import notice action");
    }
    notice.action?.onClick();

    expect(onOpenMedia).toHaveBeenCalledWith("youtube-video");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps completed imports without a media id as plain notices", () => {
    const job: IngestJob = {
      id: "ingest-youtube-video",
      sourceKind: "youtube",
      status: "completed",
      progressPercent: 100,
      originalUri: "https://www.youtube.com/watch?v=U_Ia9xKL0vI",
      title: "https://www.youtube.com/watch?v=U_Ia9xKL0vI",
    };

    expect(
      createCompletedImportNotice({
        job,
        t,
        onOpenMedia: vi.fn(),
        onDismiss: vi.fn(),
      }),
    ).toBe("Imported https://www.youtube.com/watch?v=U_Ia9xKL0vI");
  });
});
