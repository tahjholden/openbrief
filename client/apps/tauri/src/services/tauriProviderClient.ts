import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProviderRequestPlan } from "@/domain/provider";
import type { ProviderHttpResponse } from "@/services/providerAdapters";
import { canUseTauriRuntime, type TauriInvoke } from "@/services/tauriHelperClient";
import type { TrustedProviderHttpClient } from "@/services/providerService";

export { canUseTauriRuntime } from "@/services/tauriHelperClient";

export function createTauriProviderHttpClient(
  invokeCommand: TauriInvoke = invoke,
): TrustedProviderHttpClient {
  return async (
    requestPlan: ProviderRequestPlan,
    options,
  ): Promise<ProviderHttpResponse> => {
    if (!canUseTauriRuntime()) {
      throw new Error("tauri_provider_unavailable");
    }

    if (options?.onTextSnapshot && isStreamingRequestPlan(requestPlan)) {
      const requestId = createRequestId();
      const unlisten = await listen<ProviderStreamEvent>(
        "openbrief://provider-stream",
        (event) => {
          if (event.payload.requestId === requestId) {
            options.onTextSnapshot?.(event.payload.text);
          }
        },
      );

      try {
        return await invokeCommand<ProviderHttpResponse>(
          "complete_provider_stream_request",
          {
            requestPlan,
            requestId,
          },
        );
      } finally {
        unlisten();
      }
    }

    return invokeCommand<ProviderHttpResponse>("complete_provider_request", {
      requestPlan,
    });
  };
}

type ProviderStreamEvent = {
  requestId: string;
  text: string;
};

function isStreamingRequestPlan(requestPlan: ProviderRequestPlan) {
  return (
    requestPlan.body.stream === true ||
    requestPlan.endpoint.includes(":streamGenerateContent")
  );
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `provider-${Date.now()}`;
}
