"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";

import type { ApprovalItem } from "@/src/data";
import { useLocalStorage } from "@/src/hooks/useLocalStorage";

type ThemeMode = "dark" | "light";
type ApprovalDecision = "approve" | "reject";
type ChatRole = "assistant" | "user";
type StreamProviderKind = "google" | "openai";
type MobileTabId = "chat" | "approvals";
const THEME_EVENT = "dashboard-theme-change";
const APPROVAL_EXIT_DELAY_MS = 140;
const MOBILE_TAB_ORDER: MobileTabId[] = ["chat", "approvals"];
const MOBILE_SWIPE_THRESHOLD_PX = 72;
const GOOGLE_API_BASE =
  process.env.NEXT_PUBLIC_GOOGLE_API_BASE ??
  "https://generativelanguage.googleapis.com/v1beta";
// This is intentionally public for the client-only demo. In production, route these calls through a server/API layer instead.
const GOOGLE_MODEL = process.env.NEXT_PUBLIC_GOOGLE_MODEL ?? "gemini-2.0-flash";
const OPENROUTER_API_BASE =
  process.env.NEXT_PUBLIC_OPENROUTER_API_BASE ??
  "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL =
  process.env.NEXT_PUBLIC_OPENROUTER_MODEL ?? "google/gemma-3-4b-it:free";
const FALLBACK_AI_PROVIDER = process.env.NEXT_PUBLIC_FALLBACK_AI_PROVIDER
  ?.trim()
  .toLowerCase();
const APPROVE_COMMAND = "/approve ";

interface StreamProviderConfig {
  kind: StreamProviderKind;
  label: string;
  model: string;
  endpoint: string;
  apiKey: string;
  keyEnvName: string;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  meta: string;
}

interface ChatRequestMessage {
  role: ChatRole;
  content: string;
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  error?: {
    code?: number | string;
    message?: string;
  };
}

interface GoogleStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code?: number | string;
    message?: string;
  };
}

class StreamHttpError extends Error {
  constructor(
    readonly providerLabel: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`${providerLabel} request failed with status ${status}`);
    this.name = "StreamHttpError";
  }
}

interface DashboardShellProps {
  approvals: ApprovalItem[];
  initialTheme: ThemeMode;
}

function applyThemeToDocument(theme: ThemeMode): void {
  const root = document.documentElement;
  const body = document.body;

  const themeVars =
    theme === "light"
      ? {
          colorScheme: "light",
          backgroundColor: "#edf1f4",
          color: "#17202a",
          "--background": "#edf1f4",
          "--foreground": "#17202a",
          "--app-bg": "#edf1f4",
          "--panel-bg": "#f8fafb",
          "--surface-bg": "#f3f6f8",
          "--surface-bg-elevated": "#ffffff",
          "--surface-hover": "#eef3f6",
          "--panel-border": "#d3dbe3",
          "--panel-border-strong": "#bbc7d2",
          "--text-primary": "#17202a",
          "--text-secondary": "#334155",
          "--text-muted": "#708090",
          "--line-muted": "#a3b0bc",
          "--accent-positive": "#148a63",
          "--accent-positive-soft": "rgba(20, 138, 99, 0.22)",
        }
      : {
          colorScheme: "dark",
          backgroundColor: "#14181d",
          color: "#e6e8eb",
          "--background": "#14181d",
          "--foreground": "#e6e8eb",
          "--app-bg": "#14181d",
          "--panel-bg": "#1a1f26",
          "--surface-bg": "#171b22",
          "--surface-bg-elevated": "#1d232b",
          "--surface-hover": "#232a33",
          "--panel-border": "#2a313b",
          "--panel-border-strong": "#3a4450",
          "--text-primary": "#e6e8eb",
          "--text-secondary": "#d5dae0",
          "--text-muted": "#8792a0",
          "--line-muted": "#4b5662",
          "--accent-positive": "#45c69a",
          "--accent-positive-soft": "rgba(69, 198, 154, 0.32)",
        };

  root.dataset.theme = theme;
  root.style.colorScheme = themeVars.colorScheme;
  root.style.backgroundColor = themeVars.backgroundColor;
  root.style.color = themeVars.color;
  body.style.backgroundColor = themeVars.backgroundColor;
  body.style.color = themeVars.color;

  Object.entries(themeVars).forEach(([key, value]) => {
    if (key.startsWith("--")) {
      root.style.setProperty(key, value);
      body.style.setProperty(key, value);
    }
  });
}

// Render deterministic terminal timestamps to avoid server/client drift.
function formatTerminalTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().slice(11, 19) + "Z";
}

// Extract monetary values so they can be rendered in terminal metadata styling.
function extractAmount(action: string): string | null {
  const match = action.match(/\$[\d,]+(?:\.\d{2})?/);
  return match ? match[0] : null;
}

function getThemeSnapshot(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.localStorage.getItem("dashboard-theme") === "light"
    ? "light"
    : "dark";
}

const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: "seed-user",
    role: "user",
    meta: "USER | CHANNEL: OPS_DESK | 09:31:12 AST",
    content:
      "Summarize the active exception queue and isolate any actions still blocked on human authorization before market close.",
  },
  {
    id: "seed-assistant",
    role: "assistant",
    meta: "AI-CORE | MODEL: REVIEW_AGENT_V2 | STREAM: STANDBY",
    content:
      "Three high-value operations remain gated. Human review is required for wire authorization, portfolio rebalance execution, and quarterly compliance reporting. Approval queue is mirrored in the right panel with transaction-level metadata.",
  },
];

function subscribeToTheme(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: Event): void => {
    if (event instanceof StorageEvent && event.key !== "dashboard-theme") {
      return;
    }

    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_EVENT, handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_EVENT, handleStorage);
  };
}

function getPrimaryProvider(): StreamProviderConfig {
  const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";

  if (googleApiKey) {
    return {
      kind: "google",
      label: "Google Gemini",
      model: GOOGLE_MODEL,
      endpoint: `${GOOGLE_API_BASE}/models/${GOOGLE_MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(googleApiKey)}`,
      apiKey: googleApiKey,
      keyEnvName: "NEXT_PUBLIC_GOOGLE_API_KEY",
    };
  }

  const openRouterApiKey = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? "";

  if (openRouterApiKey) {
    return {
      kind: "openai",
      label: "OpenRouter",
      model: OPENROUTER_MODEL,
      endpoint: `${OPENROUTER_API_BASE}/chat/completions`,
      apiKey: openRouterApiKey,
      keyEnvName: "NEXT_PUBLIC_OPENROUTER_API_KEY",
    };
  }

  return {
    kind: "google",
    label: "Google Gemini",
    model: GOOGLE_MODEL,
    endpoint: `${GOOGLE_API_BASE}/models/${GOOGLE_MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(googleApiKey)}`,
    apiKey: googleApiKey,
    keyEnvName: "NEXT_PUBLIC_GOOGLE_API_KEY",
  };
}

function getFallbackProvider(): StreamProviderConfig | null {
  if (!FALLBACK_AI_PROVIDER) {
    return null;
  }

  if (FALLBACK_AI_PROVIDER === "google") {
    const fallbackModel =
      process.env.NEXT_PUBLIC_FALLBACK_API_MODEL ?? "gemini-2.0-flash";
    const fallbackBase =
      process.env.NEXT_PUBLIC_FALLBACK_API_URL || GOOGLE_API_BASE;

    return {
      kind: "google",
      label: "Fallback Google Gemini",
      model: fallbackModel,
      endpoint: `${fallbackBase}/models/${fallbackModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(process.env.NEXT_PUBLIC_FALLBACK_API_KEY ?? "")}`,
      apiKey: process.env.NEXT_PUBLIC_FALLBACK_API_KEY ?? "",
      keyEnvName: "NEXT_PUBLIC_FALLBACK_API_KEY",
    };
  }

  if (FALLBACK_AI_PROVIDER === "openai") {
    return {
      kind: "openai",
      label: "Fallback AI API",
      model: process.env.NEXT_PUBLIC_FALLBACK_API_MODEL ?? "",
      endpoint: process.env.NEXT_PUBLIC_FALLBACK_API_URL ?? "",
      apiKey: process.env.NEXT_PUBLIC_FALLBACK_API_KEY ?? "",
      keyEnvName: "NEXT_PUBLIC_FALLBACK_API_KEY",
    };
  }

  return null;
}

function getProviderErrorMessage(
  provider: StreamProviderConfig,
  error: unknown,
): string {
  if (!provider.apiKey) {
    return `${provider.label} API key missing. Add ${provider.keyEnvName} to .env.local and restart the dev server.`;
  }

  if (error instanceof StreamHttpError) {
    if (error.status === 400) {
      return `${provider.label} could not process this request. Please review the prompt or model configuration and try again.`;
    }

    if (error.status === 401) {
      return `${provider.label} rejected the API key. Please verify ${provider.keyEnvName} and try again.`;
    }

    if (error.status === 403) {
      return `${provider.label} denied access to this request. Please check your account permissions or model availability.`;
    }

    if (error.status === 404) {
      return `${provider.label} could not find the requested model or endpoint. Please verify the configured model name.`;
    }

    if (error.status === 408) {
      return `The request to ${provider.label} timed out before streaming began. Please try again.`;
    }

    if (error.status === 429) {
      return `${provider.label} rate limit reached. Please wait a moment and retry.`;
    }

    if (error.status >= 500) {
      return `${provider.label} is temporarily unavailable right now. Please retry in a moment.`;
    }

    if (error.responseBody) {
      try {
        const parsed = JSON.parse(error.responseBody) as {
          error?: { message?: string };
        };

        if (parsed.error?.message) {
          return `${provider.label} error: ${parsed.error.message}`;
        }
      } catch {
        // Ignore response-body parsing failures and fall back to generic messaging below.
      }
    }
  }

  if (error instanceof Error && error.message === "EMPTY_RESPONSE_BODY") {
    return `${provider.label} returned an empty stream response. Please retry the query.`;
  }

  if (error instanceof Error && error.message.startsWith("PROMPT_BLOCKED:")) {
    const blockReason = error.message.slice("PROMPT_BLOCKED:".length) || "OTHER";
    return `${provider.label} blocked this prompt (${blockReason}). Please rephrase and try again.`;
  }

  if (error instanceof TypeError) {
    return `Network error while contacting ${provider.label}. Please check your connection and try again.`;
  }

  if (error instanceof Error && error.message) {
    return `${provider.label} error: ${error.message}`;
  }

  return "Streaming interrupted while processing the request. Please retry the query.";
}

function buildGoogleContents(messages: ChatRequestMessage[]): Array<{
  role: "user" | "model";
  parts: Array<{ text: string }>;
}> {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

function extractGoogleText(chunk: GoogleStreamChunk): string {
  return (
    chunk.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

export default function DashboardShell({
  approvals,
  initialTheme,
}: DashboardShellProps): ReactElement {
  const themeMode = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    () => initialTheme,
  );
  const [approvalItems, setApprovals] = useLocalStorage<ApprovalItem[]>(
    "dashboard-approvals",
    approvals,
  );
  const [approvalStates, setApprovalStates] = useState<
    Partial<Record<string, ApprovalDecision>>
  >({});
  const [processingApprovals, setProcessingApprovals] = useState<
    Record<string, true>
  >({});
  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>(INITIAL_CHAT_MESSAGES);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [pendingRequestMessages, setPendingRequestMessages] = useState<
    ChatRequestMessage[] | null
  >(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isApprovalHintActive, setIsApprovalHintActive] = useState(false);
  const [approvalHintSuffix, setApprovalHintSuffix] = useState("");
  const [hasHydratedApprovals, setHasHydratedApprovals] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTabId>("chat");
  const [mobileTabDirection, setMobileTabDirection] = useState<1 | -1>(1);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mobileTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const pendingCount = approvalItems.length;

  useEffect(() => {
    applyThemeToDocument(themeMode);
    document.documentElement.dataset.themeReady = "true";
  }, [themeMode]);

  useEffect(() => {
    setHasHydratedApprovals(true);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isThinking]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!activePrompt || !streamingMessageId || !pendingRequestMessages) {
      return;
    }

    const requestMessages = pendingRequestMessages;
    const primaryProvider = getPrimaryProvider();
    const fallbackProvider = getFallbackProvider();
    const controller = new AbortController();
    streamAbortControllerRef.current = controller;
    const targetMessageId = streamingMessageId;

    async function streamResponse(): Promise<void> {
      let hasReceivedFirstToken = false;

      const finalizeStream = (): void => {
        setIsThinking(false);
        setIsStreaming(false);
        setStreamingMessageId(null);
        setActivePrompt(null);
        setPendingRequestMessages(null);
      };

      const appendToken = (token: string): void => {
        if (!hasReceivedFirstToken) {
          hasReceivedFirstToken = true;
          setIsThinking(false);
        }

        setChatMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === targetMessageId
              ? { ...message, content: message.content + token }
              : message,
          ),
        );
      };

      const setAssistantMeta = (provider: StreamProviderConfig): void => {
        setChatMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === targetMessageId
              ? {
                  ...message,
                  meta: `AI-CORE | MODEL: ${provider.model} | STREAM: ACTIVE`,
                }
              : message,
          ),
        );
      };

      const streamFromProvider = async (
        provider: StreamProviderConfig,
      ): Promise<void> => {
        if (!provider.apiKey) {
          throw new Error(`MISSING_KEY:${provider.keyEnvName}`);
        }

        if (provider.kind === "google") {
          const response = await fetch(provider.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: buildGoogleContents(requestMessages),
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new StreamHttpError(
              provider.label,
              response.status,
              await response.text(),
            );
          }

          if (!response.body) {
            throw new Error("EMPTY_RESPONSE_BODY");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            if (controller.signal.aborted) {
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const rawLine of lines) {
              const line = rawLine.trim();

              if (!line || !line.startsWith("data:")) {
                continue;
              }

              const data = line.slice(5).trim();

              let parsed: GoogleStreamChunk | undefined;

              try {
                parsed = JSON.parse(data) as GoogleStreamChunk;
              } catch {
                continue;
              }

              if (parsed.error?.message) {
                throw new Error(parsed.error.message);
              }

              if (parsed.promptFeedback?.blockReason) {
                throw new Error(
                  `PROMPT_BLOCKED:${parsed.promptFeedback.blockReason}`,
                );
              }

              const token = extractGoogleText(parsed);

              if (!token) {
                continue;
              }

              appendToken(token);
            }
          }

          return;
        }

        const response = await fetch(provider.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: provider.model,
            stream: true,
            messages: requestMessages,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new StreamHttpError(
            provider.label,
            response.status,
            await response.text(),
          );
        }

        if (!response.body) {
          throw new Error("EMPTY_RESPONSE_BODY");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (controller.signal.aborted) {
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();

            if (!line || !line.startsWith("data:")) {
              continue;
            }

            const data = line.slice(5).trim();

            if (data === "[DONE]") {
              return;
            }

            let parsed: OpenAiStreamChunk | undefined;

            try {
              parsed = JSON.parse(data) as OpenAiStreamChunk;
            } catch {
              continue;
            }

            if (parsed.error?.message) {
              throw new Error(parsed.error.message);
            }

            const token = parsed.choices?.[0]?.delta?.content;

            if (!token) {
              continue;
            }

            appendToken(token);
          }
        }
      };

      try {
        setAssistantMeta(primaryProvider);
        await streamFromProvider(primaryProvider);

        if (!controller.signal.aborted) {
          finalizeStream();
        }
      } catch (primaryError) {
        if (controller.signal.aborted) {
          return;
        }

        const shouldFallback =
          !hasReceivedFirstToken &&
          fallbackProvider &&
          fallbackProvider.endpoint &&
          fallbackProvider.model;

        if (shouldFallback) {
          try {
            setAssistantMeta(fallbackProvider);
            await streamFromProvider(fallbackProvider);

            if (!controller.signal.aborted) {
              finalizeStream();
            }

            return;
          } catch (fallbackError) {
            if (controller.signal.aborted) {
              return;
            }

            setChatMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === targetMessageId
                  ? {
                      ...message,
                      content: `${getProviderErrorMessage(primaryProvider, primaryError)}\n\nFallback failed: ${getProviderErrorMessage(fallbackProvider, fallbackError)}`,
                    }
                  : message,
              ),
            );

            finalizeStream();
            return;
          }
        }

        if (!controller.signal.aborted) {
          setChatMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === targetMessageId
                ? {
                    ...message,
                    content: getProviderErrorMessage(primaryProvider, primaryError),
                  }
                : message,
            ),
          );
          finalizeStream();
        }
      } finally {
        if (streamAbortControllerRef.current === controller) {
          streamAbortControllerRef.current = null;
        }
      }
    }

    void streamResponse();

    return () => {
      controller.abort();
    };
  }, [activePrompt, pendingRequestMessages, streamingMessageId]);

  function handleThemeToggle(): void {
    const nextTheme: ThemeMode = themeMode === "dark" ? "light" : "dark";

    window.localStorage.setItem("dashboard-theme", nextTheme);
    document.cookie = `dashboard-theme=${nextTheme}; path=/; max-age=31536000; samesite=lax`;
    applyThemeToDocument(nextTheme);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  function handleDecision(id: string, decision: ApprovalDecision): void {
    if (processingApprovals[id]) {
      return;
    }

    setApprovalStates((currentStates) => ({
      ...currentStates,
      [id]: decision,
    }));
    setProcessingApprovals((currentApprovals) => ({
      ...currentApprovals,
      [id]: true,
    }));

    window.setTimeout(() => {
      setApprovals((prev) => prev.filter((item) => item.id !== id));
      setProcessingApprovals((currentApprovals) => {
        const nextApprovals = { ...currentApprovals };
        delete nextApprovals[id];
        return nextApprovals;
      });
    }, APPROVAL_EXIT_DELAY_MS);
  }

  function updateApprovalCommandHint(value: string): void {
    const normalizedValue = value.toLowerCase();
    const isPartialApproveCommand =
      normalizedValue.startsWith("/") &&
      APPROVE_COMMAND.startsWith(normalizedValue) &&
      normalizedValue !== APPROVE_COMMAND;

    if (!isPartialApproveCommand) {
      setIsApprovalHintActive(false);
      setApprovalHintSuffix("");
      return;
    }

    setIsApprovalHintActive(true);
    setApprovalHintSuffix(APPROVE_COMMAND.slice(value.length));
  }

  function setDraftPromptWithHint(nextValue: string): void {
    setDraftPrompt(nextValue);
    updateApprovalCommandHint(nextValue);
  }

  function appendSystemMessage(content: string): void {
    setChatMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `system-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        role: "assistant",
        meta: "SYSTEM | CHANNEL: CONTROL_PLANE | JUST_NOW",
        content,
      },
    ]);
  }

  function handleStopStream(): void {
    streamAbortControllerRef.current?.abort();
    setIsStreaming(false);
    setIsThinking(false);
    setStreamingMessageId(null);
    setActivePrompt(null);
    setPendingRequestMessages(null);
    appendSystemMessage("[SYSTEM: STREAM_TERMINATED_BY_USER]");
  }

  function handleSubmit(): void {
    const nextPrompt = draftPrompt.trim();

    if (!nextPrompt || isStreaming) {
      return;
    }

    const approveCommandMatch = nextPrompt.match(/^\/approve\s+(.+)$/i);

    if (approveCommandMatch) {
      const remainingText = approveCommandMatch[1].trim();

      if (!remainingText) {
        return;
      }

      const newItem: ApprovalItem = {
        id: `REQ-${Math.floor(Math.random() * 10000)}`,
        action: remainingText.toUpperCase(),
        requestedAt: new Date().toISOString(),
        meta: "SRC: CHAT_TERMINAL | MANUAL_ENTRY",
      };

      setApprovals((currentItems) => [newItem, ...currentItems]);
      setChatMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `user-${Date.now()}`,
          role: "user",
          meta: "USER | CHANNEL: LIVE_QUERY | JUST_NOW",
          content: nextPrompt,
        },
      ]);
      appendSystemMessage(
        "[SYSTEM: Authorization request successfully routed to Pending Approvals.]",
      );
      setDraftPromptWithHint("");
      return;
    }

    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;

    setChatMessages((currentMessages) => {
      const nextMessages: ChatMessage[] = [
        ...currentMessages,
        {
          id: userMessageId,
          role: "user",
          meta: "USER | CHANNEL: LIVE_QUERY | JUST_NOW",
          content: nextPrompt,
        },
        {
          id: assistantMessageId,
          role: "assistant",
          meta: `AI-CORE | MODEL: ${GOOGLE_MODEL} | STREAM: ACTIVE`,
          content: "",
        },
      ];

      setPendingRequestMessages(
        nextMessages
          .filter((message) => message.id !== assistantMessageId)
          .map((message) => ({
            role: message.role,
            content: message.content,
          })),
      );

      return nextMessages;
    });
    setDraftPromptWithHint("");
    setIsStreaming(true);
    setIsThinking(true);
    setStreamingMessageId(assistantMessageId);
    setActivePrompt(nextPrompt);
  }

  function switchMobileTab(nextTab: MobileTabId): void {
    if (nextTab === activeMobileTab) {
      return;
    }

    const currentIndex = MOBILE_TAB_ORDER.indexOf(activeMobileTab);
    const nextIndex = MOBILE_TAB_ORDER.indexOf(nextTab);
    setMobileTabDirection(nextIndex > currentIndex ? 1 : -1);
    setActiveMobileTab(nextTab);
  }

  function shiftMobileTab(direction: 1 | -1): void {
    const currentIndex = MOBILE_TAB_ORDER.indexOf(activeMobileTab);
    const nextIndex = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= MOBILE_TAB_ORDER.length) {
      return;
    }

    setMobileTabDirection(direction);
    setActiveMobileTab(MOBILE_TAB_ORDER[nextIndex]);
  }

  function handleMobileTouchStart(
    event: React.TouchEvent<HTMLDivElement>,
  ): void {
    const touch = event.changedTouches[0];

    mobileTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleMobileTouchEnd(
    event: React.TouchEvent<HTMLDivElement>,
  ): void {
    const touchStart = mobileTouchStartRef.current;
    mobileTouchStartRef.current = null;

    if (!touchStart) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    if (
      Math.abs(deltaX) < MOBILE_SWIPE_THRESHOLD_PX ||
      Math.abs(deltaX) <= Math.abs(deltaY) * 1.15
    ) {
      return;
    }

    shiftMobileTab(deltaX < 0 ? 1 : -1);
  }

  const mobileTabTriggerClassName =
    "flex-1 rounded-sm border px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors focus:ring-2 focus:ring-emerald-500 focus:outline-none";

  function renderChatPanel(
    titleId: string,
    className: string,
    panelId?: string,
    tabId?: string,
  ): ReactElement {
    return (
      <section
        id={panelId}
        role={panelId ? "tabpanel" : undefined}
        aria-labelledby={tabId ?? titleId}
        aria-describedby={tabId ? titleId : undefined}
        className={className}
      >
        <div className="flex items-start justify-between gap-3 rounded-t-md border-b border-[var(--panel-border)] bg-[var(--surface-bg)] px-3 py-2 sm:items-center">
          <div>
            <p className="font-mono text-xs tracking-wide text-[var(--accent-positive)]">
              MODULE: CONVERSATION_TERMINAL
            </p>
            <h1
              id={titleId}
              className="mt-1 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-primary)] sm:tracking-[0.18em]"
            >
              AI Assistant Chat
            </h1>
          </div>
          <div className="max-w-[7rem] text-right font-mono text-[10px] leading-4 text-[var(--text-muted)] sm:max-w-none sm:text-xs">
            SESSION: LIVE_FEED
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <div className="min-h-0 overflow-hidden rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg-elevated)]">
            <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain p-3">
              <div className="space-y-3">
                {chatMessages.map((message) => {
                  const isAssistant = message.role === "assistant";
                  const isActiveStream =
                    isAssistant &&
                    isStreaming &&
                    message.id === streamingMessageId;

                  return (
                    <div
                      key={message.id}
                      className={`border-l-2 pl-3 ${
                        isAssistant
                          ? "border-[var(--accent-positive-soft)]"
                          : "border-[var(--line-muted)]"
                      }`}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
                        {message.meta
                          .split(" | ")
                          .map((part, index, parts) => (
                            <span
                              key={`${message.id}-${part}`}
                              className={
                                isAssistant && index === 0
                                  ? "text-[var(--accent-positive)]"
                                  : undefined
                              }
                            >
                              {part}
                              {index < parts.length - 1 ? (
                                <span className="px-3 text-[var(--line-muted)]">
                                  |
                                </span>
                              ) : null}
                            </span>
                          ))}
                      </div>

                      {isActiveStream && isThinking ? (
                        <div
                          aria-live="polite"
                          aria-label="Assistant is thinking"
                          className="flex items-center gap-2 py-1 text-[var(--text-muted)]"
                        >
                          <span className="font-mono text-xs tracking-[0.14em] text-[var(--accent-positive)]">
                            SYSTEM: AWAITING_STREAM...
                          </span>
                          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-positive)] [animation-delay:-0.2s]" />
                          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-positive)] [animation-delay:-0.1s]" />
                          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-positive)]" />
                        </div>
                      ) : (
                        <p className="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                          {message.content}
                          {isActiveStream ? (
                            <motion.span
                              aria-hidden="true"
                              animate={{ opacity: [0.2, 1, 0.2] }}
                              transition={{
                                duration: 0.9,
                                ease: "easeInOut",
                                repeat: Number.POSITIVE_INFINITY,
                              }}
                              className="ml-0.5 inline-block text-[var(--accent-positive)]"
                            >
                              ▍
                            </motion.span>
                          ) : null}
                        </p>
                      )}
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </div>
          </div>

          <form
            suppressHydrationWarning
            className="rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg-elevated)]"
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmit();
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] px-3 py-2">
              <p className="font-mono text-[10px] leading-4 text-[var(--text-muted)] sm:text-xs">
                INPUT_BUFFER // COMMAND_LINE ACTIVE
              </p>
              <p className="font-mono text-[10px] leading-4 text-[var(--line-muted)] sm:text-xs">
                {isStreaming ? "STREAM_LOCK ENGAGED" : "READY_FOR_QUERY"}
              </p>
            </div>
            <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start">
              <div className="flex items-start gap-2 sm:flex-1">
                <label className="min-w-0 flex-1">
                <span className="sr-only">Message the AI assistant</span>
                <input
                  suppressHydrationWarning
                  ref={inputRef}
                  type="text"
                  value={draftPrompt}
                  disabled={isStreaming}
                  onChange={(event) =>
                    setDraftPromptWithHint(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Tab" && isApprovalHintActive) {
                      event.preventDefault();
                      setDraftPromptWithHint(APPROVE_COMMAND);
                      requestAnimationFrame(() => {
                        inputRef.current?.focus();
                        inputRef.current?.setSelectionRange(
                          APPROVE_COMMAND.length,
                          APPROVE_COMMAND.length,
                        );
                      });
                      return;
                    }

                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="Ask AI a question, or type /approve to authorize..."
                  className="w-full rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--panel-border-strong)] focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="mt-2 flex min-h-4 items-center justify-between gap-3">
                  <div className="min-w-0 font-mono text-[10px] text-zinc-500 sm:text-xs">
                    {isApprovalHintActive ? (
                      <p className="truncate">
                        Tab to autocomplete: {draftPrompt}
                        <span className="text-zinc-500">{approvalHintSuffix}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
                </label>
                <button
                  type="submit"
                  disabled={isStreaming || draftPrompt.trim().length === 0}
                  className="shrink-0 rounded-sm border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 font-mono text-[11px] tracking-[0.16em] text-emerald-400 transition-colors hover:bg-emerald-500/16 focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:border-[var(--panel-border)] disabled:bg-[var(--surface-bg)] disabled:text-[var(--text-muted)] disabled:hover:bg-[var(--surface-bg)] sm:px-4 sm:text-xs"
                >
                  SEND
                </button>
              </div>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStopStream}
                  className="rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2.5 font-mono text-xs tracking-[0.16em] text-red-500 transition-colors hover:bg-red-500/16 focus:ring-2 focus:ring-red-500 focus:outline-none"
                >
                  STOP
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </section>
    );
  }

  function renderApprovalsPanel(
    titleId: string,
    className: string,
    panelId?: string,
    tabId?: string,
  ): ReactElement {
    return (
      <section
        id={panelId}
        role={panelId ? "tabpanel" : undefined}
        aria-labelledby={tabId ?? titleId}
        aria-describedby={tabId ? titleId : undefined}
        className={className}
      >
        <div className="flex items-center justify-between gap-3 rounded-t-md border-b border-[var(--panel-border)] bg-[var(--surface-bg)] px-3 py-2">
          <div className="flex items-center gap-3">
            <div>
              <p className="font-mono text-xs tracking-wide text-[var(--accent-positive)]">
                MODULE: HUMAN_APPROVAL_QUEUE
              </p>
              <h2
                id={titleId}
                className="mt-1 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)]"
              >
                Pending Approvals
              </h2>
            </div>
            <span className="rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg-elevated)] px-2 py-0.5 font-mono text-xs text-[var(--accent-positive)]">
              {(hasHydratedApprovals ? pendingCount : approvals.length)
                .toString()
                .padStart(2, "0")}
            </span>
          </div>
          <div className="font-mono text-xs text-[var(--text-muted)]">
            FEED: PRIORITY_SORT
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 p-3">
          <div className="min-h-0 overflow-hidden rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg-elevated)]">
            <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain p-3">
              {!hasHydratedApprovals ? (
                <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-[var(--panel-border-strong)] bg-[var(--surface-bg-elevated)] px-4 py-8 text-center">
                  <div>
                    <p className="font-mono text-xs tracking-[0.18em] text-[var(--accent-positive)]">
                      SYNCING_QUEUE
                    </p>
                    <p className="mt-3 text-sm text-[var(--text-secondary)]">
                      Restoring your saved approval state...
                    </p>
                  </div>
                </div>
              ) : approvalItems.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-[var(--panel-border-strong)] bg-[var(--surface-bg-elevated)] px-4 py-8 text-center">
                  <div>
                    <p className="font-mono text-xs tracking-[0.18em] text-[var(--accent-positive)]">
                      QUEUE_EMPTY
                    </p>
                    <p className="mt-3 text-sm text-[var(--text-secondary)]">
                      All pending authorizations cleared.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 pr-1">
                  <AnimatePresence initial={false}>
                    {approvalItems.map((approval) => {
                      const amount = extractAmount(approval.action);
                      const decision = approvalStates[approval.id];
                      const isProcessing = Boolean(
                        processingApprovals[approval.id],
                      );
                      const cardBorderClass =
                        decision === "approve"
                          ? "border-emerald-500/45 shadow-[0_0_0_1px_rgba(16,185,129,0.22)]"
                          : decision === "reject"
                            ? "border-rose-500/40 shadow-[0_0_0_1px_rgba(244,63,94,0.18)]"
                            : "border-[var(--panel-border)] hover:border-[var(--panel-border-strong)]";

                      return (
                        <motion.article
                          key={approval.id}
                          layout
                          initial={{ opacity: 0, y: 14, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -10, scale: 0.97 }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                          className={`rounded-sm border bg-[var(--surface-bg-elevated)] p-3 transition-colors ${cardBorderClass}`}
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-mono text-xs text-[var(--text-muted)]">
                                {approval.id}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[var(--text-primary)]">
                                {approval.action}
                              </p>
                            </div>
                            <span className="border border-emerald-500/30 px-2 py-1 font-mono text-xs text-emerald-400">
                              {isProcessing ? "PROCESSING" : "PENDING"}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--text-muted)]">
                            <span>
                              {formatTerminalTimestamp(approval.requestedAt)}
                            </span>
                            <span className="text-[var(--line-muted)]">|</span>
                            <span>{approval.meta}</span>
                            {amount ? (
                              <>
                                <span className="text-[var(--line-muted)]">
                                  |
                                </span>
                                <span>NOTIONAL: {amount}</span>
                              </>
                            ) : null}
                          </div>

                          <div className="mt-4 flex gap-2">
                            <button
                              type="button"
                              aria-label={`Approve ${approval.id}`}
                              aria-pressed={decision === "approve"}
                              disabled={isProcessing}
                              onClick={() =>
                                handleDecision(approval.id, "approve")
                              }
                              className={`rounded-sm border px-3 py-1.5 font-mono text-xs transition-colors focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                                decision === "approve"
                                  ? "border-emerald-500/50 bg-emerald-500/14 text-emerald-300"
                                  : "border-emerald-500/30 bg-emerald-500/6 text-emerald-400 hover:bg-emerald-500/12"
                              }`}
                            >
                              APPROVE
                            </button>
                            <button
                              type="button"
                              aria-label={`Reject ${approval.id}`}
                              aria-pressed={decision === "reject"}
                              disabled={isProcessing}
                              onClick={() =>
                                handleDecision(approval.id, "reject")
                              }
                              className={`rounded-sm border px-3 py-1.5 font-mono text-xs transition-colors focus:ring-2 focus:ring-rose-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                                decision === "reject"
                                  ? "border-rose-500/45 bg-rose-500/14 text-rose-300"
                                  : "border-rose-500/25 bg-rose-500/5 text-rose-400 hover:bg-rose-500/10"
                              }`}
                            >
                              REJECT
                            </button>
                          </div>
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-[var(--app-bg)] text-[var(--text-primary)] transition-colors duration-200">
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col px-3 py-3 sm:px-4">
        <header className="mb-2 shrink-0 flex flex-col gap-2 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.12)] sm:mb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden font-mono text-xs text-[var(--text-muted)] sm:block">
            SYSTEM: AI-CORE // ENV: PROD // REGION: USE1 // LATENCY: 18MS
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--text-muted)] sm:text-xs">
            <span className="rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg)] px-2 py-1 text-[var(--accent-positive)]">
              STATUS: ONLINE
            </span>
            <span className="rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg)] px-2 py-1">
              QUEUE: {pendingCount.toString().padStart(2, "0")}
            </span>
            <button
              type="button"
              aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} theme`}
              aria-pressed={themeMode === "light"}
              onClick={handleThemeToggle}
              className="rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg)] px-2 py-1 text-[var(--text-secondary)] transition-colors hover:border-[var(--panel-border-strong)] hover:bg-[var(--surface-hover)] focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            >
              MODE: {themeMode === "dark" ? "DARK" : "LIGHT"}
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col lg:hidden">
            <div className="mb-2 shrink-0 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2 shadow-[0_14px_36px_rgba(0,0,0,0.10)]">
              <div
                role="tablist"
                aria-label="Dashboard sections"
                className="flex gap-2"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMobileTab === "chat"}
                  aria-controls="mobile-chat-panel"
                  id="mobile-chat-tab"
                  onClick={() => switchMobileTab("chat")}
                  className={`${mobileTabTriggerClassName} ${
                    activeMobileTab === "chat"
                      ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-300"
                      : "border-[var(--panel-border)] bg-[var(--surface-bg)] text-[var(--text-muted)]"
                  }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMobileTab === "approvals"}
                  aria-controls="mobile-approvals-panel"
                  id="mobile-approvals-tab"
                  onClick={() => switchMobileTab("approvals")}
                  className={`${mobileTabTriggerClassName} ${
                    activeMobileTab === "approvals"
                      ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-300"
                      : "border-[var(--panel-border)] bg-[var(--surface-bg)] text-[var(--text-muted)]"
                  }`}
                >
                  Approvals
                </button>
              </div>
            </div>

            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              onTouchStart={handleMobileTouchStart}
              onTouchEnd={handleMobileTouchEnd}
            >
              <AnimatePresence initial={false} custom={mobileTabDirection} mode="wait">
                <motion.div
                  key={activeMobileTab}
                  custom={mobileTabDirection}
                  initial={{ x: mobileTabDirection > 0 ? "16%" : "-16%", opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: mobileTabDirection > 0 ? "-16%" : "16%", opacity: 0 }}
                  transition={{ duration: 0.24, ease: "easeOut" }}
                  className="h-full min-h-0"
                >
                  {activeMobileTab === "chat"
                    ? renderChatPanel(
                        "mobile-chat-panel-title",
                        "flex h-full min-h-0 flex-col rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_14px_36px_rgba(0,0,0,0.10)]",
                        "mobile-chat-panel",
                        "mobile-chat-tab",
                      )
                    : renderApprovalsPanel(
                        "mobile-approvals-panel-title",
                        "flex h-full min-h-0 min-w-0 flex-col rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_14px_36px_rgba(0,0,0,0.10)]",
                        "mobile-approvals-panel",
                        "mobile-approvals-tab",
                      )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-3 flex shrink-0 items-center justify-center gap-2">
              {MOBILE_TAB_ORDER.map((tab) => {
                const isActive = tab === activeMobileTab;

                return (
                  <button
                    key={tab}
                    type="button"
                    aria-label={`Show ${tab} panel`}
                    aria-pressed={isActive}
                    onClick={() => switchMobileTab(tab)}
                    className={`h-2.5 w-2.5 rounded-full border transition-all ${
                      isActive
                        ? "border-emerald-400 bg-emerald-400 shadow-[0_0_10px_rgba(69,198,154,0.45)]"
                        : "border-[var(--panel-border-strong)] bg-transparent"
                    }`}
                  />
                );
              })}
            </div>
          </div>

          <div className="hidden min-h-0 flex-1 gap-3 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)]">
            {renderChatPanel(
              "desktop-chat-panel-title",
              "flex min-h-0 flex-col rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_14px_36px_rgba(0,0,0,0.10)]",
            )}
            {renderApprovalsPanel(
              "desktop-approvals-panel-title",
              "flex min-h-0 min-w-0 flex-col rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_14px_36px_rgba(0,0,0,0.10)]",
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
