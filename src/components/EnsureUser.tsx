"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/format";

/** Creates/refreshes the Convex profile row before any authed query runs. */
export function EnsureUser({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    ensure().then(() => setReady(true)).catch((e) => setError(errorMessage(e)));
  }, [isAuthenticated, ensure]);

  if (error) return <p className="p-6 text-sm text-red-700">Could not load your profile: {error}</p>;
  if (isLoading || !ready) return <p className="p-6 text-sm text-stone-500">Loading...</p>;
  return <>{children}</>;
}
