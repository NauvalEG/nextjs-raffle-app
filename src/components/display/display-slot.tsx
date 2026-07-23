"use client";

import * as React from "react";

// Per-slot rendering for the public display board (E2-01 Features 2 and 5).
// States: placeholder → scrambling (~500–800 ms) → settled; plus the
// distinct pulsing "redrawing…" treatment confined to its own slot (BR1/BR2).
// No status, reason, or ticket data can be rendered here — the props carry
// prize label and full name only (Feature 1 BR1).

export type SlotState =
  | { kind: "scrambling"; fullName: string }
  | { kind: "settled"; fullName: string }
  | { kind: "redrawing" };
// Absent state = "not yet drawn" placeholder.

// Fixed duration inside the FSD's ~500–800 ms band (Feature 2 BR4). A single
// constant guarantees a simultaneous batch animates and settles together in
// one window rather than staggering.
const SCRAMBLE_MS = 650;
const SCRAMBLE_FRAME_MS = 50;
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ";

// Math.random is PERMITTED here: the scramble is purely cosmetic presentation
// and sits outside all draw paths — the fair random pick already happened
// server-side with crypto.getRandomValues (E1-04). See FSD E2-01 Feature 2 BR3.
function randomScramble(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
  }
  return out;
}

function ScrambledName({
  target,
  onSettle,
}: {
  target: string;
  onSettle: () => void;
}) {
  const [text, setText] = React.useState(() => randomScramble(target.length));
  // Keep the latest settle callback without restarting the animation when the
  // parent re-renders mid-scramble.
  const onSettleRef = React.useRef(onSettle);
  React.useEffect(() => {
    onSettleRef.current = onSettle;
  });

  React.useEffect(() => {
    // Regenerate same-length random characters each frame, then settle.
    const interval = setInterval(() => {
      setText(randomScramble(target.length));
    }, SCRAMBLE_FRAME_MS);
    const timer = setTimeout(() => {
      clearInterval(interval);
      onSettleRef.current();
    }, SCRAMBLE_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [target]);

  return <span className="whitespace-pre-wrap">{text}</span>;
}

export function DisplaySlot({
  prizeLabel,
  state,
  onSettle,
}: {
  prizeLabel: string;
  state: SlotState | undefined;
  onSettle: () => void;
}) {
  return (
    <div
      className={
        "flex min-h-32 flex-col justify-between rounded-xl border p-5 " +
        (state?.kind === "redrawing"
          ? "border-neutral-500 bg-neutral-900"
          : "border-neutral-800 bg-neutral-900/60")
      }
    >
      <p className="text-sm font-medium tracking-widest text-neutral-400 uppercase">
        {prizeLabel}
      </p>
      <p className="mt-3 text-2xl leading-tight font-semibold break-words lg:text-3xl">
        {state === undefined ? (
          <span className="text-lg font-normal text-neutral-500 lg:text-xl">
            not yet drawn
          </span>
        ) : state.kind === "redrawing" ? (
          // Distinct pulsing treatment; no reason/status language (BR3).
          <span className="animate-pulse text-lg font-normal text-neutral-300 lg:text-xl">
            Redrawing…
          </span>
        ) : state.kind === "scrambling" ? (
          <ScrambledName target={state.fullName} onSettle={onSettle} />
        ) : (
          <span className="text-neutral-50">{state.fullName}</span>
        )}
      </p>
    </div>
  );
}
