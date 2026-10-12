import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.js";
import "./index.css";
import { registerServiceWorker } from "./register-sw.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
