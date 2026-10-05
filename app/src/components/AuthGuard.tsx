import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { RouteLoading } from "./RouteLoading";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { account, loading } = useAuth();
  const location = useLocation();

  if (loading) return <RouteLoading label="Checking session…" />;
  if (!account) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
