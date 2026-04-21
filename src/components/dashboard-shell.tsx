"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";

import type { ApprovalItem } from "@/src/data";

type ThemeMode = "dark" | "light";
type ApprovalDecision = "approve" | "reject";
const THEME_EVENT = "dashboard-theme-change";
const APPROVAL_EXIT_DELAY_MS = 140;

interface DashboardShellProps {
  approvals: ApprovalItem[];
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

function getServerThemeSnapshot(): ThemeMode {
  return "dark";
}

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

export default function DashboardShell({
  approvals,
}: DashboardShellProps): ReactElement {
  const themeMode = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const [approvalItems, setApprovals] = useState<ApprovalItem[]>(() => approvals);
  const [approvalStates, setApprovalStates] = useState<
    Partial<Record<string, ApprovalDecision>>
  >({});
  const [processingApprovals, setProcessingApprovals] = useState<
    Record<string, true>
  >({});
  const pendingCount = approvalItems.length;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("dashboard-theme", themeMode);
  }, [themeMode]);

  function handleThemeToggle(): void {
    const nextTheme: ThemeMode = themeMode === "dark" ? "light" : "dark";

    window.localStorage.setItem("dashboard-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
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

  return (
    <main className="min-h-screen bg-[var(--app-bg)] text-[var(--text-primary)] transition-colors duration-200">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-3 py-3 sm:px-4">
        <header className="mb-3 flex flex-col gap-2 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.12)] sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono text-xs text-[var(--text-muted)]">
            SYSTEM: AI-CORE // ENV: PROD // REGION: USE1 // LATENCY: 18MS
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--text-muted)]">
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

        <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)]">
          <section
            aria-labelledby="chat-panel-title"
            className="flex min-h-[36rem] flex-col rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_14px_36px_rgba(0,0,0,0.10)]"
          >
            <div className="flex items-center justify-between gap-3 rounded-t-md border-b border-[var(--panel-border)] bg-[var(--surface-bg)] px-3 py-2">
              <div>
                <p className="font-mono text-xs tracking-wide text-[var(--accent-positive)]">
                  MODULE: CONVERSATION_TERMINAL
                </p>
                <h1
                  id="chat-panel-title"
                  className="mt-1 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)]"
                >
                  AI Assistant Chat
                </h1>
              </div>
              <div className="font-mono text-xs text-[var(--text-muted)]">
                SESSION: LIVE_FEED
              </div>
            </div>

            <div className="grid flex-1 gap-3 p-3 xl:grid-rows-[1fr_auto]">
              <div className="space-y-3 overflow-hidden rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg-elevated)] p-3">
                <div className="border-l-2 border-[var(--line-muted)] pl-3">
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
                    <span>USER</span>
                    <span className="text-[var(--line-muted)]">|</span>
                    <span>CHANNEL: OPS_DESK</span>
                    <span className="text-[var(--line-muted)]">|</span>
                    <span>09:31:12 AST</span>
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                    Summarize the active exception queue and isolate any actions
                    still blocked on human authorization before market close.
                  </p>
                </div>

                <div className="border-l-2 border-[var(--accent-positive-soft)] pl-3">
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
                    <span className="text-[var(--accent-positive)]">AI-CORE</span>
                    <span className="text-[var(--line-muted)]">|</span>
                    <span>MODEL: REVIEW_AGENT_V2</span>
                    <span className="text-[var(--line-muted)]">|</span>
                    <span>STREAM: STANDBY</span>
                  </div>
                  <p className="max-w-4xl text-sm leading-6 text-[var(--text-secondary)]">
                    Three high-value operations remain gated. Human review is
                    required for wire authorization, portfolio rebalance
                    execution, and quarterly compliance reporting. Approval
                    queue is mirrored in the right panel with transaction-level
                    metadata.
                  </p>
                </div>
              </div>

              <div className="rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg-elevated)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] px-3 py-2">
                  <p className="font-mono text-xs text-[var(--text-muted)]">
                    INPUT_BUFFER // COMMAND_LINE DISABLED
                  </p>
                  <p className="font-mono text-xs text-[var(--line-muted)]">
                    STEP_1_PLACEHOLDER
                  </p>
                </div>
                <div className="px-3 py-4 text-sm text-[var(--text-muted)]">
                  Terminal composer, streaming response behavior, and send
                  controls will be wired in the next step.
                </div>
              </div>
            </div>
          </section>

          <section
            aria-labelledby="approvals-panel-title"
            className="flex min-h-[36rem] flex-col rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[0_14px_36px_rgba(0,0,0,0.10)]"
          >
            <div className="flex items-center justify-between gap-3 rounded-t-md border-b border-[var(--panel-border)] bg-[var(--surface-bg)] px-3 py-2">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-mono text-xs tracking-wide text-[var(--accent-positive)]">
                    MODULE: HUMAN_APPROVAL_QUEUE
                  </p>
                  <h2
                    id="approvals-panel-title"
                    className="mt-1 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)]"
                  >
                    Pending Approvals
                  </h2>
                </div>
                <span className="rounded-sm border border-[var(--panel-border)] bg-[var(--surface-bg-elevated)] px-2 py-0.5 font-mono text-xs text-[var(--accent-positive)]">
                  {pendingCount.toString().padStart(2, "0")}
                </span>
              </div>
              <div className="font-mono text-xs text-[var(--text-muted)]">
                FEED: PRIORITY_SORT
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-3">
              <div className="flex flex-1 flex-col gap-3">
                <AnimatePresence initial={false}>
                  {approvalItems.map((approval) => {
                    const amount = extractAmount(approval.action);
                    const decision = approvalStates[approval.id];
                    const isProcessing = Boolean(processingApprovals[approval.id]);
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
                          <span>{formatTerminalTimestamp(approval.requestedAt)}</span>
                          <span className="text-[var(--line-muted)]">|</span>
                          <span>{approval.meta}</span>
                          {amount ? (
                            <>
                              <span className="text-[var(--line-muted)]">|</span>
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
                            onClick={() => handleDecision(approval.id, "approve")}
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
                            onClick={() => handleDecision(approval.id, "reject")}
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

                {approvalItems.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-[var(--panel-border-strong)] bg-[var(--surface-bg-elevated)] px-4 py-8 text-center">
                    <div>
                      <p className="font-mono text-xs tracking-[0.18em] text-[var(--accent-positive)]">
                        QUEUE_EMPTY
                      </p>
                      <p className="mt-3 text-sm text-[var(--text-secondary)]">
                        All pending authorizations cleared.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
