import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * This page is the landing target after any Google OAuth flow completes.
 *
 * The backend issues a redirect to /auth/callback?token=<jwt> after a
 * successful Google sign-in. This page:
 *   1. Reads the token from the URL search params
 *   2. Stores it in localStorage so AuthContext picks it up
 *   3. Registers the auth token getter (so API calls work immediately)
 *   4. Does a full page navigation to /dashboard (triggers AuthContext
 *      re-initialisation with the stored token)
 *
 * A full navigation (window.location.href) is used deliberately —
 * wouter's client-side routing would not re-run the AuthContext
 * initialisation effect, so the user would appear logged-out.
 */
export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const err = params.get("error");

    if (err) {
      const messages: Record<string, string> = {
        oauth_denied: "You denied access. Please try again.",
        no_code: "OAuth code was missing. Please try again.",
        no_token: "Could not exchange token. Please try again.",
        no_email: "Google did not return an email address.",
        oauth_failed: "Authentication failed. Please try again.",
      };
      setError(messages[err] ?? "An unknown error occurred.");
      return;
    }

    if (!token) {
      setError("No authentication token received.");
      return;
    }

    // Persist the token and wire up the auth getter before navigating
    localStorage.setItem("auth_token", token);
    setAuthTokenGetter(() => localStorage.getItem("auth_token"));

    // Full page load so React re-initialises with the token already in storage
    window.location.href = "/dashboard";
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-sm mx-auto px-4">
          <div className="flex justify-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Authentication Failed</h2>
          <p className="text-muted-foreground text-sm">{error}</p>
          <a
            href="/login"
            className="inline-block mt-4 text-primary underline text-sm hover:opacity-80"
          >
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground text-sm">Completing sign-in...</p>
      </div>
    </div>
  );
}
