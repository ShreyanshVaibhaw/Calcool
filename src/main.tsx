import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Quick from "./Quick";
import { setWorkdayConfig, Region } from "./engine/workdays";

// workday holidays follow the OS locale region until there is a settings UI
const localeRegion = (): Region => {
  const tag = (navigator.language || "").split("-").pop()?.toUpperCase();
  if (tag === "IN") return "IN";
  if (tag === "GB" || tag === "UK") return "UK";
  return "US";
};
setWorkdayConfig({ region: localeRegion() });

const isQuick = new URLSearchParams(window.location.search).has("quick");
if (isQuick) document.body.classList.add("quick-body");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isQuick ? <Quick /> : <App />}</React.StrictMode>,
);
