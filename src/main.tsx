import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LifeHub } from "../app/life-hub";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LifeHub />
  </StrictMode>,
);
