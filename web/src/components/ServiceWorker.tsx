"use client";

import { useEffect } from "react";

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/**
 * Registers the worker and, just as importantly, keeps checking for a new one.
 *
 * An installed PWA is resumed rather than launched, so without an explicit
 * update check on resume it can run an old build indefinitely. This asks for a
 * fresh worker on load and every time the app becomes visible again, and
 * reloads once when a new one takes control.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | undefined;

    const checkForUpdate = () => {
      registration?.update().catch(() => {});
      // A worker already waiting means an update arrived while the app was
      // closed; tell it to take over now rather than on some later launch.
      if (registration?.waiting) registration.waiting.postMessage("skip-waiting");
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    navigator.serviceWorker
      .register(`/sw.js?v=${BUILD}`)
      .then((reg) => {
        registration = reg;
        checkForUpdate();
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
