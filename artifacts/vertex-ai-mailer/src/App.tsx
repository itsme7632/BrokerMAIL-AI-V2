import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AppLayout } from "@/components/layout/AppLayout";

import Home from "@/pages/Home";
import Pricing from "@/pages/Pricing";
import FAQ from "@/pages/FAQ";
import Contact from "@/pages/Contact";
import Trust from "@/pages/Trust";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import Refund from "@/pages/Refund";
import About from "@/pages/About";
import Help from "@/pages/Help";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import AuthCallback from "@/pages/AuthCallback";
import VerifyEmail from "@/pages/VerifyEmail";
import Dashboard from "@/pages/Dashboard";
import LeadsImport from "@/pages/LeadsImport";
import Templates from "@/pages/Templates";
import TemplateEditor from "@/pages/TemplateEditor";
import TemplateGallery from "@/pages/TemplateGallery";
import Drafts from "@/pages/Drafts";
import Settings from "@/pages/Settings";
import MailboxSettings from "@/pages/MailboxSettings";
import Plans from "@/pages/Plans";
import UpgradeConfirmation from "@/pages/UpgradeConfirmation";
import Admin from "@/pages/Admin";
import AdminLogin from "@/pages/AdminLogin";
import NotFound from "@/pages/not-found";
import SentEmails from "@/pages/SentEmails";
import Campaigns from "@/pages/Campaigns";
import CampaignDetail from "@/pages/CampaignDetail";
import Maintenance from "@/pages/Maintenance";
import SingleEmailComposer from "@/pages/SingleEmailComposer";
import DesignTemplateLibrary from "@/pages/DesignTemplateLibrary";
import SupportTickets from "@/pages/SupportTickets";
import SupportTicketDetail from "@/pages/SupportTicketDetail";
import SuppressionList from "@/pages/SuppressionList";
import Unsubscribe from "@/pages/Unsubscribe";
import WhatsNew from "@/pages/WhatsNew";
import Roadmap from "@/pages/Roadmap";
import Feedback from "@/pages/Feedback";
import ReportBug from "@/pages/ReportBug";

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
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/refund-policy" component={Refund} />
      <Route path="/about" component={About} />
      <Route path="/help" component={Help} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/auth/callback" component={AuthCallback} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/unsubscribe" component={Unsubscribe} />

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

      <Route path="/compose">
        <ProtectedRoute>
          <AppLayout><SingleEmailComposer /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/design-templates">
        <ProtectedRoute>
          <AppLayout><DesignTemplateLibrary /></AppLayout>
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

      <Route path="/upgrade-confirmation">
        <ProtectedRoute>
          <AppLayout><UpgradeConfirmation /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/support/:id">
        <ProtectedRoute>
          <AppLayout><SupportTicketDetail /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/support">
        <ProtectedRoute>
          <AppLayout><SupportTickets /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/suppressions">
        <ProtectedRoute>
          <AppLayout><SuppressionList /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/whats-new">
        <ProtectedRoute>
          <AppLayout><WhatsNew /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/roadmap">
        <ProtectedRoute>
          <AppLayout><Roadmap /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/product-hub/feedback">
        <ProtectedRoute>
          <AppLayout><Feedback /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/report-bug">
        <ProtectedRoute>
          <AppLayout><ReportBug /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
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
    </ThemeProvider>
  );
}

export default App;
