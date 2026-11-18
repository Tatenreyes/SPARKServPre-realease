"use client";

/**
 * The inline troubleshooting block for the "Problem description" section.
 *
 * It replaces the permanent side-panel card, which rendered steps as soon as an
 * appliance was chosen. Nothing is shown here until an issue has been
 * **identified**: either the customer picked one from the list, or they confirmed
 * a suggestion produced by `matchIssue()`.
 *
 * All matching and selection logic lives in `src/lib/issue-matching.ts`; this
 * component only presents the result and reports the customer's choices upward.
 *
 * Two rules keep it from becoming a second form:
 *   * it owns **no issue list**, the chips in the wizard are the one place a fault is
 *     chosen, so the catalogue is never rendered twice, and
 *   * every state speaks through `AssistantBubble`, so the panel has one voice.
 */

import { useState, type ReactNode } from "react";
import { Lightbulb } from "lucide-react";
import { getIssueLabel } from "@/lib/appliance-issues";
import type { IssueMatchResult, TroubleshootingOutcome } from "@/lib/issue-matching";
import {
  NO_GUIDE_MESSAGE,
  TROUBLESHOOTING_DISCLAIMER,
  type TroubleshootingStep,
} from "@/lib/troubleshooting";

export interface TroubleshootingPanelProps {
  applianceType: string;
  /** What the matcher found for the current description. */
  match: IssueMatchResult;
  /** The identified issue: explicitly selected or a confirmed suggestion. */
  identifiedIssueId: string | null;
  /** The guide for the identified issue (null = none exists). */
  guide: TroubleshootingStep[] | null;
  outcome: TroubleshootingOutcome | null;
  /** The customer confirmed the suggested issue. */
  onConfirmSuggestion: (issueId: string) => void;
  /** The customer said the suggestion is wrong. */
  onRejectSuggestion: () => void;
  /** The customer picked an issue from a list. */
  onChooseIssue: (issueId: string) => void;
  doneSteps: string[];
  onStepDone: (title: string) => void;
  onOutcomeChange: (outcome: TroubleshootingOutcome) => void;
  /** "Skip troubleshooting" / "Continue without troubleshooting". */
  onSkip: () => void;
  /** A suggestion was already rejected for the current description. */
  suggestionDismissed: boolean;
  /** The customer has not described anything yet. */
  awaitingDescription: boolean;
}

export default function TroubleshootingPanel({
  applianceType,
  match,
  identifiedIssueId,
  guide,
  outcome,
  onConfirmSuggestion,
  onRejectSuggestion,
  onChooseIssue,
  doneSteps,
  onStepDone,
  onOutcomeChange,
  onSkip,
  suggestionDismissed,
  awaitingDescription,
}: TroubleshootingPanelProps) {
  const identifiedLabel = getIssueLabel(applianceType, identifiedIssueId);

  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const step = stepIndex === null ? undefined : guide?.[stepIndex];

  if (outcome === "unresolved" && identifiedLabel) {
    return (
      <AssistantBubble label="Troubleshooting summary">
        <p className="text-sm text-ink">
          Continue with your repair request. Your technician will see the reported
          issue and any checks you marked as completed.
        </p>
      </AssistantBubble>
    );
  }

  if (outcome === "skipped") return null;

  if (identifiedIssueId && identifiedLabel) {
    return (
      <AssistantBubble label="Guided troubleshooting">
        <p className="text-sm font-semibold text-ink">{identifiedLabel}</p>
        <p className="mt-2 text-sm text-muted">{TROUBLESHOOTING_DISCLAIMER}</p>
        <p className="mt-2 text-sm text-muted">
          Skip the checks if you notice smoke, sparks, a burning smell, or damaged wiring.
          Do not open the appliance or handle wiring.
        </p>
        {!guide?.length ? (
          <p className="mt-3 text-sm text-muted">{NO_GUIDE_MESSAGE}</p>
        ) : stepIndex === null ? (
          <div className="mt-3">
            <GuideButton onClick={() => setStepIndex(0)} label="Try troubleshooting" />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {step && (
              <>
                <div aria-live="polite" aria-atomic="true">
                  <p className="text-xs text-muted">Step {stepIndex + 1} of {guide.length}</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 text-sm text-muted">{step.detail}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <GuideButton
                    onClick={() => {
                      onStepDone(step.title);
                      setStepIndex(stepIndex + 1);
                    }}
                    label="Mark done and continue"
                  />
                  <GuideButton onClick={() => setStepIndex(stepIndex + 1)} label="Skip this check" />
                </div>
              </>
            )}
            {!step && <p className="text-sm text-muted">You have reached the end of the checks.</p>}
            {doneSteps.length > 0 && (
              <GuideButton onClick={() => onOutcomeChange("resolved")} label="The problem is fixed" />
            )}
          </div>
        )}
        <ContinueWithout onClick={() => stepIndex === null ? onSkip() : onOutcomeChange("unresolved")} />
      </AssistantBubble>
    );
  }

  // ---- 2. A supported issue was recognised: ask before showing anything -----
  if (!awaitingDescription && !suggestionDismissed && match.kind === "match") {
    const label = getIssueLabel(applianceType, match.issueId);
    if (label) {
      return (
        <AssistantBubble label="Confirm the detected problem">
          <p className="text-sm leading-relaxed text-ink">
            That sounds like <span className="font-semibold">{label}</span>. Is that right?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            We recognised “{match.matchedPhrase}” in your description. Nothing is assumed, your description stays exactly as you wrote it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onConfirmSuggestion(match.issueId)}
              className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl bg-brand-500 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-600"
            >
              Yes, that&apos;s it
            </button>
            <button
              type="button"
              onClick={onRejectSuggestion}
              className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border border-line bg-surface px-4 text-xs font-semibold text-ink/75 transition duration-200 hover:bg-soft"
            >
              No, let me pick
            </button>
          </div>
        </AssistantBubble>
      );
    }
  }

  // ---- 3. Several equally specific issues: the customer chooses -------------
  if (!awaitingDescription && !suggestionDismissed && match.kind === "ambiguous") {
    return (
      <AssistantBubble label="Choose the problem">
        <p className="text-sm leading-relaxed text-ink">
          Your description could match more than one problem. Which is closest?
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {match.candidates.map((candidate) => (
            <IssueChip
              key={candidate.issueId}
              label={getIssueLabel(applianceType, candidate.issueId) ?? candidate.issueId}
              onClick={() => onChooseIssue(candidate.issueId)}
            />
          ))}
        </div>
        <ContinueWithout onClick={onSkip} />
      </AssistantBubble>
    );
  }

  // ---- 4. Nothing identified: say so once, and point at the chips above -----
  //
  // Nothing at all until the customer has said something. An empty card under an
  // untouched textarea is noise, and the issue chips are already on screen above.
  if (awaitingDescription) return null;

  return (
    <AssistantBubble label="Troubleshooting unavailable">
      <p className="text-xs leading-relaxed text-muted">
        {suggestionDismissed
          ? "No problem, pick the closest issue from the list above to see whether a guide is available."
          : "We couldn't identify the exact problem from your description. Pick the closest issue from the list above to see whether a guide is available, or continue without troubleshooting: your request can still be submitted, and a technician will diagnose it on site."}
      </p>
      <ContinueWithout onClick={onSkip} />
    </AssistantBubble>
  );
}

function AssistantBubble({
  label,
  children,
}: {
  /** What this bubble is, for assistive technology. */
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-5">
      {/* The assistant's identity: this is a conversation, not another form section. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="text-xs font-semibold text-ink">SPARKServ assistant</p>
      </div>

      <div
        aria-label={label}
        className="mt-2 rounded-2xl rounded-tl-sm border border-line bg-surface p-4 sm:p-5"
      >
        {children}
      </div>
    </div>
  );
}

function ContinueWithout({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-ink underline-offset-2 hover:underline"
    >
      Continue to repair request
    </button>
  );
}

function GuideButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-soft"
    >
      {label}
    </button>
  );
}

function IssueChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[36px] cursor-pointer items-center rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink/80 transition duration-200 hover:border-brand-300 hover:bg-brand-soft"
    >
      {label}
    </button>
  );
}
