import {
  getWorkspaceStorageItem,
  setWorkspaceStorageItem,
} from "@/services/workspaceStorage";

const onboardingStorageKey = "openbrief.onboarding-complete";

export function readOnboardingComplete(
  storage: Storage | undefined = browserLocalStorage(),
) {
  try {
    return getWorkspaceStorageItem(onboardingStorageKey, storage) === "true";
  } catch {
    return false;
  }
}

export function writeOnboardingComplete(
  done: boolean,
  storage: Storage | undefined = browserLocalStorage(),
) {
  try {
    setWorkspaceStorageItem(onboardingStorageKey, String(done), storage);
  } catch {
    // Keep first-run state in memory if browser storage is unavailable.
  }
}

function browserLocalStorage() {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
