"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a line of chalk on one line. The text never wraps; when it is wider
 * than the space it has, its font size is reduced until it fits.
 *
 * Two things make this less trivial than it looks. The box being measured is
 * often a flex item, so if its width came from its own content the measurement
 * would be of the unshrunk text rather than the space actually available;
 * callers pass `boxClassName="flex-1"` to give it a definite basis. And a
 * single proportional step lands a pixel or so long, because scrollWidth is
 * integer rounded, so the fit steps down until it genuinely fits.
 */
export default function FitText({
  children,
  className = "",
  boxClassName = "",
  minScale = 0.4,
}: {
  children: React.ReactNode;
  className?: string;
  boxClassName?: string;
  minScale?: number;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  // Guards against the observers re-entering on our own style write.
  const busy = useRef(false);

  const fit = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    requestAnimationFrame(() => {
      busy.current = false;
    });
    const b = box.current;
    const t = text.current;
    if (!b || !t) return;

    t.style.fontSize = "";
    const base = parseFloat(getComputedStyle(t).fontSize);
    // A pixel of slack: scrollWidth and clientWidth are both integer rounded,
    // so fitting to the exact number can still leave a hairline overflow.
    const available = b.clientWidth - 1;
    if (!base || available <= 0) return;
    if (t.scrollWidth <= available) return;

    let size = Math.max(base * minScale, base * (available / t.scrollWidth));
    t.style.fontSize = `${size}px`;
    // Converge: proportional scaling undershoots slightly at these sizes.
    for (let i = 0; i < 14 && t.scrollWidth > available; i++) {
      size = Math.max(base * minScale, size * 0.96);
      t.style.fontSize = `${size}px`;
      if (size <= base * minScale) break;
    }
  }, [minScale]);

  useEffect(() => {
    fit();
    // Watch the box for changes in available space, and the text itself for
    // changes in intrinsic width. The second one is what catches the webfont
    // swapping in after the first fit: fonts.ready can resolve while the
    // fallback face is still painted, and the real face is wider.
    const observer = new ResizeObserver(fit);
    if (box.current) observer.observe(box.current);
    if (text.current) observer.observe(text.current);

    const onLoadingDone = () => fit();
    document.fonts?.addEventListener?.("loadingdone", onLoadingDone);
    document.fonts?.ready.then(fit).catch(() => {});

    // Belt and braces. fonts.ready can resolve before the real face is painted
    // and the observers do not reliably fire on a swap, so re-fit a few times
    // over the first couple of seconds. Each pass is a cheap measurement that
    // does nothing when the text already fits.
    const timers = [120, 350, 800, 1600].map((ms) => window.setTimeout(fit, ms));

    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", onLoadingDone);
      timers.forEach(clearTimeout);
    };
  }, [fit, children]);

  return (
    <span ref={box} className={`block min-w-0 overflow-hidden ${boxClassName}`}>
      <span ref={text} className={`inline-block whitespace-nowrap ${className}`}>
        {children}
      </span>
    </span>
  );
}
