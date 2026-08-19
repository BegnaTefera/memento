"use client";

import { useEffect, useRef, useState } from "react";

export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    // Coarse pointers (touch) don't get a synthetic cursor — there's no
    // mouse to follow, and it would just sit uselessly on screen.
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (isCoarse || prefersReducedMotion) return;
    setEnabled(true);

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const ring = { x: target.x, y: target.y };

    function handleMove(e: MouseEvent) {
      target.x = e.clientX;
      target.y = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${target.x}px, ${target.y}px) translate(-50%, -50%)`;
      }
    }

    function handleOver(e: MouseEvent) {
      const el = (e.target as HTMLElement)?.closest("a, button, [data-cursor-hover]");
      setHovering(!!el);
    }

    window.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseover", handleOver);

    // The ring lags behind the raw cursor position for a soft trailing
    // feel — the dot itself (above) tracks instantly.
    let frame: number;
    function tick() {
      ring.x += (target.x - ring.x) * 0.18;
      ring.y += (target.y - ring.y) * 0.18;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ring.x}px, ${ring.y}px) translate(-50%, -50%)`;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseover", handleOver);
      cancelAnimationFrame(frame);
    };
  }, []);

  if (!enabled) return null;

  return (
    <>
      <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
      <div ref={ringRef} className="cursor-ring" data-hovering={hovering} aria-hidden="true" />
    </>
  );
}
