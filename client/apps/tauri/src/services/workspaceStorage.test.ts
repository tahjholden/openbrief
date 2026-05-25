import {
  activeWorkspaceStorageKey,
  getWorkspaceStorageItem,
  readActiveWorkspaceId,
  removeWorkspaceStorageItem,
  setWorkspaceStorageItem,
  workspaceStorageKey,
  writeActiveWorkspaceId,
} from "@/services/workspaceStorage";
import { beforeEach, describe, expect, it } from "vitest";

describe("workspace storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses legacy keys for the default workspace", () => {
    localStorage.setItem("openbrief.theme", "dark");

    expect(readActiveWorkspaceId()).toBe("default");
    expect(workspaceStorageKey("openbrief.theme")).toBe("openbrief.theme");
    expect(getWorkspaceStorageItem("openbrief.theme")).toBe("dark");
  });

  it("scopes values for non-default workspaces", () => {
    writeActiveWorkspaceId("research");
    setWorkspaceStorageItem("openbrief.theme", "dark");

    expect(localStorage.getItem("openbrief.theme")).toBeNull();
    expect(
      localStorage.getItem("openbrief.workspace.research.openbrief.theme"),
    ).toBe("dark");

    writeActiveWorkspaceId("default");
    expect(getWorkspaceStorageItem("openbrief.theme")).toBeNull();

    writeActiveWorkspaceId("research");
    expect(getWorkspaceStorageItem("openbrief.theme")).toBe("dark");
  });

  it("removes only the active workspace value", () => {
    localStorage.setItem("openbrief.theme", "light");
    writeActiveWorkspaceId("research");
    setWorkspaceStorageItem("openbrief.theme", "dark");
    removeWorkspaceStorageItem("openbrief.theme");

    expect(getWorkspaceStorageItem("openbrief.theme")).toBeNull();

    writeActiveWorkspaceId("default");
    expect(getWorkspaceStorageItem("openbrief.theme")).toBe("light");
  });

  it("keeps the active workspace pointer global", () => {
    writeActiveWorkspaceId("workspace two");

    expect(localStorage.getItem(activeWorkspaceStorageKey)).toBe(
      "workspace two",
    );
    expect(workspaceStorageKey("openbrief.theme")).toBe(
      "openbrief.workspace.workspace%20two.openbrief.theme",
    );
  });
});
