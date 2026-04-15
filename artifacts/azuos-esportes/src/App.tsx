import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmModal } from "@/components/ConfirmModal";
import { MatchResultModal } from "@/components/MatchResultModal";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { usePageTracking } from "@/hooks/usePageTracking";
import BlockedPage from "@/pages/BlockedPage";

// Pages
import Home from "@/pages/Home";
import Agendamento from "@/pages/Agendamento";
import BeachTennis from "@/pages/BeachTennis";
import CopaAzuos from "@/pages/CopaAzuos";
import TournamentDetail from "@/pages/TournamentDetail";
import Galeria from "@/pages/Galeria";
import Contato from "@/pages/Contato";
import Admin from "@/pages/Admin";
import Login from "@/pages/Login";
import Super from "@/pages/Super";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function PageTracker() {
  usePageTracking();
  return null;
}

function Router() {
  return (
    <>
      <ScrollToTop />
      <PageTracker />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/agendamento" component={Agendamento} />
        <Route path="/beach-tennis" component={BeachTennis} />
        <Route path="/copa" component={CopaAzuos} />
        <Route path="/copa/:id" component={TournamentDetail} />
        <Route path="/galeria" component={Galeria} />
        <Route path="/contato" component={Contato} />
        <Route path="/admin" component={Admin} />
        <Route path="/login" component={Login} />
        <Route path="/super" component={Super} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

const BYPASS_PATHS = ["/super", "/login"];

function AppContent() {
  const [location] = useLocation();
  const { profile, loading } = useCompanyProfile();

  const isBypassed = BYPASS_PATHS.some((p) => location === p || location.startsWith(p + "/"));

  if (!loading && !profile.tenant_active && !isBypassed) {
    return <BlockedPage superLogoUrl={profile.super_logo_url} />;
  }

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppContent />
        </WouterRouter>
        <Toaster />
        <SonnerToaster position="bottom-right" theme="dark" />
        <ConfirmModal />
        <MatchResultModal />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
