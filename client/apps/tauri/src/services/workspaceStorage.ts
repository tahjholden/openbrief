export const activeWorkspaceStorageKey = "openbrief.active-workspace-id";

export function readActiveWorkspaceId(
  storage: Storage | undefined = browserLocalStorage(),
): string {
  if (!storage) return "default";

  return normalizeWorkspaceId(storage.getItem(activeWorkspaceStorageKey));
}

export function writeActiveWorkspaceId(
  workspaceId: string,
  storage: Storage | undefined = browserLocalStorage(),
): string {
  const normalized = normalizeWorkspaceId(workspaceId);

  try {
    storage?.setItem(activeWorkspaceStorageKey, normalized);
  } catch {
    // Keep the Rust workspace state authoritative if browser storage is unavailable.
  }

  return normalized;
}

export function workspaceStorageKey(
  key: string,
  storage: Storage | undefined = browserLocalStorage(),
): string {
  const workspaceId = readActiveWorkspaceId(storage);
  if (workspaceId === "default") return key;

  return `openbrief.workspace.${encodeURIComponent(workspaceId)}.${key}`;
}

export function getWorkspaceStorageItem(
  key: string,
  storage: Storage | undefined = browserLocalStorage(),
): string | null {
  if (!storage) return null;

  return storage.getItem(workspaceStorageKey(key, storage));
}

export function setWorkspaceStorageItem(
  key: string,
  value: string,
  storage: Storage | undefined = browserLocalStorage(),
) {
  storage?.setItem(workspaceStorageKey(key, storage), value);
}

export function removeWorkspaceStorageItem(
  key: string,
  storage: Storage | undefined = browserLocalStorage(),
) {
  storage?.removeItem(workspaceStorageKey(key, storage));
}

function normalizeWorkspaceId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "default";
}

function browserLocalStorage() {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
