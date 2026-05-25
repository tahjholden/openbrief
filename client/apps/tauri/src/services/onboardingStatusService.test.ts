import {
  readOnboardingComplete,
  writeOnboardingComplete,
} from "@/services/onboardingStatusService";
import { writeActiveWorkspaceId } from "@/services/workspaceStorage";
import { beforeEach, describe, expect, it } from "vitest";

describe("onboarding status service", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses the legacy onboarding key for the default workspace", () => {
    writeOnboardingComplete(true);

    expect(localStorage.getItem("openbrief.onboarding-complete")).toBe("true");
    expect(readOnboardingComplete()).toBe(true);
  });

  it("isolates onboarding completion by workspace", () => {
    writeActiveWorkspaceId("research");
    writeOnboardingComplete(true);

    writeActiveWorkspaceId("default");
    expect(readOnboardingComplete()).toBe(false);

    writeActiveWorkspaceId("research");
    expect(readOnboardingComplete()).toBe(true);
  });
});
