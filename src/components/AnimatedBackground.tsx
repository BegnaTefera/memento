"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseAlpha: number;
  color: string;
}

const COLORS = ["198, 222, 135", "245, 245, 240"]; // accent, text-hi, as rgb triplets

export default function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let particles: Particle[] = [];
    const mouse = { x: width / 2, y: height / 2 };

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width;
      canvas!.height = height;
      const count = Math.min(70, Math.round((width * height) / 22000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        r: Math.random() * 1.6 + 0.6,
        baseAlpha: Math.random() * 0.35 + 0.08,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
    }
    resize();
    window.addEventListener("resize", resize);

    function handleMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }
    window.addEventListener("mousemove", handleMove);

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        const dist = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        const proximity = Math.max(0, 1 - dist / 180);
        const alpha = p.baseAlpha + proximity * 0.4;
        const radius = p.r + proximity * 1.5;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${p.color}, ${alpha})`;
        ctx!.fill();
      }
    }

    if (prefersReducedMotion) {
      // Draw a single static frame — still communicates the texture,
      // without a perpetual animation loop for people who asked to avoid one.
      draw();
      return () => {
        window.removeEventListener("resize", resize);
        window.removeEventListener("mousemove", handleMove);
      };
    }

    let frame: number;
    function loop() {
      draw();
      frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
