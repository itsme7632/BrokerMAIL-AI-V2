import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AppLayout } from "@/components/layout/AppLayout";

import Home from "@/pages/Home";
import Pricing from "@/pages/Pricing";
import FAQ from "@/pages/FAQ";
import Contact from "@/pages/Contact";
import Trust from "@/pages/Trust";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import LeadsImport from "@/pages/LeadsImport";
import Templates from "@/pages/Templates";
import TemplateEditor from "@/pages/TemplateEditor";
import TemplateGallery from "@/pages/TemplateGallery";
import Drafts from "@/pages/Drafts";
import Settings from "@/pages/Settings";
import MailboxSettings from "@/pages/MailboxSettings";
import Plans from "@/pages/Plans";
import Admin from "@/pages/Admin";
import AdminLogin from "@/pages/AdminLogin";
import NotFound from "@/pages/not-found";
import SentEmails from "@/pages/SentEmails";
import Campaigns from "@/pages/Campaigns";
import CampaignDetail from "@/pages/CampaignDetail";
import Maintenance from "@/pages/Maintenance";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Maintenance page — always accessible */}
      <Route path="/maintenance" component={Maintenance} />

      {/* Public routes */}
      <Route path="/" component={Home} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/faq" component={FAQ} />
      <Route path="/contact" component={Contact} />
      <Route path="/trust" component={Trust} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/auth/callback" component={AuthCallback} />

      {/* Admin auth */}
      <Route path="/admin/login" component={AdminLogin} />

      {/* Admin protected routes */}
      <Route path="/admin/dashboard">
        <AdminRoute>
          <AppLayout><Admin /></AppLayout>
        </AdminRoute>
      </Route>

      <Route path="/admin">
        <AdminRoute>
          <Redirect to="/admin/dashboard" />
        </AdminRoute>
      </Route>

      {/* User protected routes */}
      <Route path="/dashboard">
        <ProtectedRoute>
          <AppLayout><Dashboard /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/leads/import">
        <ProtectedRoute>
          <AppLayout><LeadsImport /></AppLayout>
        </ProtectedRoute>
      </Route>

      {/* Template Gallery MUST come before /templates/:id */}
      <Route path="/templates/gallery">
        <ProtectedRoute>
          <AppLayout><TemplateGallery /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/templates">
        <ProtectedRoute>
          <AppLayout><Templates /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/templates/:id">
        <ProtectedRoute>
          <AppLayout><TemplateEditor /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sent-emails">
        <ProtectedRoute>
          <AppLayout><SentEmails /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/campaigns/:id">
        <ProtectedRoute>
          <AppLayout><CampaignDetail /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/campaigns">
        <ProtectedRoute>
          <AppLayout><Campaigns /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/drafts">
        <ProtectedRoute>
          <AppLayout><Drafts /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/settings">
        <ProtectedRoute>
          <AppLayout><Settings /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/mailbox">
        <ProtectedRoute>
          <AppLayout><MailboxSettings /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/plans">
        <ProtectedRoute>
          <AppLayout><Plans /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
