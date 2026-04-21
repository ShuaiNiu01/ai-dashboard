# AI Assistant Dashboard Report

This README is the final project report for tonight's build. Instead of stopping at "what the app does", it also captures how the feature set evolved, what bugs we fixed along the way, and how the code review questions were answered in the implementation.

The overall direction stayed consistent: make the dashboard feel cinematic, but keep the interaction model safe, interruptible, and trustworthy. We prioritized user confidence over cleverness whenever the two pulled in different directions.

## What We Built

We shipped a fintech-style AI operations dashboard with two main surfaces:

- A streaming AI chat terminal
- A human approval queue with animated approve/reject actions
- Theme persistence across refreshes
- Slash-command support for quickly creating approval requests
- Local persistence for saved approval state
- Layout and hydration fixes to reduce UI flicker and stale state flashes

## How To Run

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` if you want live AI streaming:

```bash
NEXT_PUBLIC_GOOGLE_API_KEY=your_google_key
# Optional
NEXT_PUBLIC_GOOGLE_MODEL=gemini-2.0-flash
NEXT_PUBLIC_GOOGLE_API_BASE=https://generativelanguage.googleapis.com/v1beta

# Or use OpenRouter instead
NEXT_PUBLIC_OPENROUTER_API_KEY=your_openrouter_key
NEXT_PUBLIC_OPENROUTER_MODEL=google/gemma-3-4b-it:free
NEXT_PUBLIC_OPENROUTER_API_BASE=https://openrouter.ai/api/v1

# Optional fallback provider
NEXT_PUBLIC_FALLBACK_AI_PROVIDER=google
NEXT_PUBLIC_FALLBACK_API_KEY=your_fallback_key
NEXT_PUBLIC_FALLBACK_API_MODEL=gemini-2.0-flash
NEXT_PUBLIC_FALLBACK_API_URL=https://generativelanguage.googleapis.com/v1beta
```

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`

5. Optional verification:

```bash
npm run lint
```

Note: the UI still renders without API keys, but streaming requests will surface the configured missing-key error state instead of a live model response.

## Tech Stack

- Next.js 16.2.4 with the App Router
- React 19.2.4
- TypeScript 5
- Tailwind CSS 4
- Framer Motion for approval-card and stream cursor animation
- `next/font` with Geist and Geist Mono
- Browser `fetch` streaming with `AbortController`
- `localStorage` plus `useSyncExternalStore` for persisted client state

## Architecture Notes

- `app/layout.tsx` provides metadata, fonts, and the initial cookie-backed theme snapshot.
- `app/page.tsx` reads the saved theme from cookies and renders the dashboard entry route.
- `src/components/dashboard-shell.tsx` owns the main interaction model: chat streaming, approvals, slash commands, fallback provider logic, and theme toggling.
- `src/hooks/useLocalStorage.ts` wraps persistence with `useSyncExternalStore` so the UI reads storage in a React-safe way.

This structure fit the assignment well because the route stays simple while the interactive surface remains isolated in one client component.

## A11y Implementation Details

We treated accessibility as part of interaction quality, not just as a checklist item.

- The root layout sets a clear page title and description through Next metadata, which supports the framework's built-in route announcement behavior.
- The two main surfaces use labeled landmarks via `aria-labelledby`, so screen reader users can distinguish the chat terminal from the approvals queue.
- Theme toggle and approval actions expose `aria-label` and `aria-pressed`, making stateful controls more legible to assistive tech.
- The streaming "thinking" state uses `aria-live="polite"` so users are informed when the assistant is actively responding.
- The input includes an `sr-only` label instead of relying only on placeholder text.
- Focus-ring styles are present on interactive controls, so keyboard users can track where they are.
- Disabled states are explicit during streaming or approval processing, which reduces accidental duplicate actions.
- Theme colors are driven through shared CSS variables, which helped keep contrast decisions consistent across dark and light mode.
- The animated stream cursor is marked `aria-hidden="true"` so decorative motion is not announced as content.

Honest note: we improved practical accessibility, but we did not add a dedicated reduced-motion pathway yet. That would be a strong next pass.

## Tonight's Build Story

Based on the current code and commit trail, tonight's work progressed in a healthy order: get the core interaction working, then make it safer, then make it smoother.

1. We started with the approval workflow: animated cards, approve/reject decisions, and functional state updates to keep removal logic reliable.
2. We added the chat panel and then upgraded it into a streaming terminal with live token rendering.
3. We wired provider configuration through environment variables so the UI could work with Google Gemini or OpenRouter.
4. We improved the streaming experience by carrying request message history and appending system feedback where appropriate.
5. We added slash-command autocomplete so `/approve` feels fast and intentional instead of clunky.
6. We tightened layout responsiveness so the split panels behave better across screen sizes.
7. We fixed localStorage hydration issues to prevent stale approval flashes during startup.
8. We finished by adding theme switching and persisting that preference across cookie and client storage boundaries.

What I appreciate most about this sequence is that the bug fixes were not "patches after the real work". They were part of the real work. The final product feels more trustworthy because we kept revisiting correctness while adding polish.

## Code Review Answers

### Q1: Streaming cleanup (AbortController)

The streaming implementation uses `AbortController` in the right places and for the right reason. Each active request gets its own controller, the controller is stored in a ref, and cleanup happens in three paths:

- component unmount cleanup
- effect cleanup when a new stream lifecycle replaces the old one
- explicit user cancellation through the `STOP` button

That matters because streamed `fetch` readers can otherwise continue emitting data after the UI has logically moved on. By checking `controller.signal.aborted` before applying streamed chunks and aborting in cleanup, we avoid orphaned network activity and stale state writes.

### Q2: Concurrent actions (Button disabled state & functional `prev => prev.filter` updates)

The concurrency handling is solid and intentionally defensive.

- While chat is streaming, the text input and submit button are disabled.
- While an approval is processing, its action buttons are disabled.
- Approval removal uses a functional state update: `setApprovals((prev) => prev.filter(...))`.

That last part is the key review answer. Functional updates protect us from stale closures when multiple actions, animation delays, or queued state updates overlap. In plain language: we always remove from the freshest approval list, not from an older snapshot.

### Q3: Worst trade-off

The worst trade-off in this implementation is the lack of real-time Markdown parsing, especially for finance-heavy outputs such as tables.

We deliberately render streamed output as plain pre-wrapped text because token-by-token streaming is predictable, fast, and easy to interrupt. The downside is that structured content like financial tables, column alignment, and richer Markdown presentation does not get upgraded into a more readable live format.

If I had to defend the choice, I would say it was the correct compromise for this pass: reliability first, formatting richness second. But it is still the weakest product trade-off in the current experience.

### Q4: AI Tool usage

One thing the AI got wrong was the first pass at local state hydration. It treated the approval list like it was ready immediately, which caused a brief stale flash on load. I changed that flow by adding a hydration guard and showing a syncing state first, so the queue only renders once the saved client state is actually ready.

## Final Reflection

The strongest part of this build is not any single animation or styling decision. It is the interaction discipline underneath the UI:

- streams can be stopped cleanly
- concurrent actions are guarded
- persisted state is hydrated more carefully
- the interface keeps keyboard and assistive-tech affordances in view

That combination is what makes the dashboard feel dependable instead of merely impressive.

## End Of Process

This project is at a good stopping point for the assignment handoff. If there were one next step after submission, I would invest it in richer streamed content rendering for structured financial responses without compromising the current cancellation and concurrency guarantees.
