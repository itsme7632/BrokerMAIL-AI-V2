import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// TEMP DEBUG ONLY — remove before finishing
const __t = new URLSearchParams(location.search).get("debugtoken");
if (__t) localStorage.setItem("auth_token", __t);

createRoot(document.getElementById("root")!).render(<App />);
