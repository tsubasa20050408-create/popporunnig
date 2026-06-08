import React from "react";
import ReactDOM from "react-dom/client";
import TrainingApp from "./TrainingApp.jsx";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><TrainingApp /></React.StrictMode>
);

// PWA: Service Worker 登録（共有メニューからの取込に必要）
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}
