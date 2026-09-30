import { Toaster } from "@/components/ui/sonner";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import Navbar from "./components/Navbar";
import { ConfigProvider } from "./contexts/ConfigContext";
import { RecetteProvider } from "./contexts/RecetteContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import Config from "./pages/Config";
import History from "./pages/History";
import Home from "./pages/Home";
import Simulation from "./pages/Simulation";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/config" component={Config} />
      <Route path="/simulation" component={Simulation} />
      <Route path="/historique" component={History} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <ConfigProvider>
          <RecetteProvider>
            <Toaster />
            <Navbar />
            <Router />
          </RecetteProvider>
        </ConfigProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
