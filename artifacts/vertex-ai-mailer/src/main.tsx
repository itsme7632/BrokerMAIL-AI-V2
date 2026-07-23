import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Register the auth token getter before any React Query hooks fire their
// first request. Running this at module load in main.tsx (outside the HMR
// boundary) avoids the race condition and keeps AuthContext.tsx HMR-clean.
setAuthTokenGetter(() => localStorage.getItem("auth_token"));

createRoot(document.getElementById("root")!).render(<App />);
