"use client";

import { useInView } from "motion/react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Hydration-safe reduced-motion preference: `false` on the server and during hydration. */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

export function useNarrativePlayback(
  ref: RefObject<HTMLDivElement | null>,
  length: number,
  interval: number | readonly number[] = 2300,
  enabled = true,
) {
  const inView = useInView(ref, { amount: 0.15 });
  const reduce = useReducedMotionSafe();
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(true);
  const playing = enabled && running && !reduce && step < length - 1;
  const duration = typeof interval === "number" ? interval : (interval[step] ?? 2300);
  useEffect(() => {
    if (!playing || !inView) return;
    const timer = setTimeout(
      () => setStep((s) => Math.min(s + 1, length - 1)),
      duration,
    );
    return () => clearTimeout(timer);
  }, [step, playing, inView, length, duration]);
  const seek = (next: number) => {
    setRunning(false);
    setStep(Math.max(0, Math.min(next, length - 1)));
  };
  const replay = () => {
    setStep(0);
    setRunning(true);
  };
  return {
    step,
    playing,
    reduce,
    seek,
    replay,
    atEnd: step === length - 1,
    toggle: () => setRunning((v) => !v),
  };
}
