import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ConfigProvider } from "./contexts/ConfigContext";
import { SimulationProvider } from "./contexts/SimulationContext";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import Config from "./pages/Config";
import Simulation from "./pages/Simulation";
import History from "./pages/History";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/config" component={Config} />
      <Route path="/simulation" component={Simulation} />
      <Route path="/historique" component={History} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <ConfigProvider>
          <SimulationProvider>
            <TooltipProvider>
              <Toaster />
              <Navbar />
              <Router />
            </TooltipProvider>
          </SimulationProvider>
        </ConfigProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
