import "./localPreview";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LifeHub } from "../app/life-hub";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LifeHub />
  </StrictMode>,
);

// Own (empty) service worker for this folder, so a root-level worker from another app on the same
// address can't serve Life Hub stale files. See public/sw.js.
if ('serviceWorker' in navigator && import.meta.env.VITE_LOCAL_PREVIEW !== 'true') {
  const base = import.meta.env.BASE_URL || '/';
  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
}
