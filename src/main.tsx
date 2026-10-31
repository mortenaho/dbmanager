import React from "react";
import ReactDOM from "react-dom/client";
import "./monaco";
import App from "./App";
import "./ssms.css";
import { applyTheme, storedTheme } from "./theme";

applyTheme(storedTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
