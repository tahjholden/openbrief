import type { TauriInvoke } from "@/services/tauriHelperClient";
import { canUseTauriRuntime } from "@/services/tauriHelperClient";
import { writeActiveWorkspaceId } from "@/services/workspaceStorage";
import { invoke } from "@tauri-apps/api/core";

export type WorkspaceDescriptor = {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  active: boolean;
};

export type WorkspaceSnapshot = {
  activeWorkspaceId: string;
  workspaces: WorkspaceDescriptor[];
};

export type WorkspaceService = {
  loadSnapshot(): Promise<WorkspaceSnapshot>;
  createWorkspace(name?: string): Promise<WorkspaceSnapshot>;
  switchWorkspace(workspaceId: string): Promise<WorkspaceSnapshot>;
};

const defaultWorkspaceSnapshot: WorkspaceSnapshot = {
  activeWorkspaceId: "default",
  workspaces: [
    {
      id: "default",
      name: "Default",
      path: "",
      isDefault: true,
      active: true,
    },
  ],
};

export function createWorkspaceService(
  invokeCommand: TauriInvoke = invoke,
): WorkspaceService {
  if (!canUseTauriRuntime()) {
    return createMockWorkspaceService();
  }

  return {
    async loadSnapshot() {
      const snapshot =
        await invokeCommand<WorkspaceSnapshot>("workspace_snapshot");
      writeActiveWorkspaceId(snapshot.activeWorkspaceId);
      return snapshot;
    },
    async createWorkspace(name) {
      const snapshot = await invokeCommand<WorkspaceSnapshot>(
        "create_workspace",
        name === undefined ? {} : { name },
      );
      writeActiveWorkspaceId(snapshot.activeWorkspaceId);
      return snapshot;
    },
    async switchWorkspace(workspaceId) {
      const snapshot = await invokeCommand<WorkspaceSnapshot>(
        "switch_workspace",
        {
          workspaceId,
        },
      );
      writeActiveWorkspaceId(snapshot.activeWorkspaceId);
      return snapshot;
    },
  };
}

export function createMockWorkspaceService(): WorkspaceService {
  let snapshot = defaultWorkspaceSnapshot;

  return {
    async loadSnapshot() {
      writeActiveWorkspaceId(snapshot.activeWorkspaceId);
      return snapshot;
    },
    async createWorkspace(name = "Workspace 2") {
      const id = workspaceIdFromName(name);
      snapshot = {
        activeWorkspaceId: id,
        workspaces: [
          ...snapshot.workspaces.map((workspace) => ({
            ...workspace,
            active: false,
          })),
          {
            id,
            name,
            path: `workspace/${id}`,
            isDefault: false,
            active: true,
          },
        ],
      };
      writeActiveWorkspaceId(snapshot.activeWorkspaceId);
      return snapshot;
    },
    async switchWorkspace(workspaceId) {
      snapshot = {
        activeWorkspaceId: workspaceId,
        workspaces: snapshot.workspaces.map((workspace) => ({
          ...workspace,
          active: workspace.id === workspaceId,
        })),
      };
      writeActiveWorkspaceId(snapshot.activeWorkspaceId);
      return snapshot;
    },
  };
}

export function reloadForWorkspaceChange() {
  window.location.reload();
}

function workspaceIdFromName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workspace"
  );
}
