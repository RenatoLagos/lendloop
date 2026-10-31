"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { LoanCard } from "@/components/LoanCard";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import { errorMessage } from "@/lib/format";

export default function AdminPage() {
  const me = useQuery(api.users.me);
  // Skip the admin queries entirely for non-admins; Convex would reject them anyway.
  const isAdmin = me?.role === "admin";
  const users = useQuery(api.users.listAll, isAdmin ? {} : "skip");
  const loans = useQuery(api.loans.adminAll, isAdmin ? {} : "skip");
  const setTrusted = useMutation(api.users.setTrustedLender);
  const [error, setError] = useState<string | null>(null);

  if (me === undefined) return <p className="text-sm text-stone-500">Loading...</p>;
  if (!isAdmin) return <Empty>You do not have access to this page. (Enforced by the Convex functions, not just the UI.)</Empty>;

  return (
    <>
      <PageTitle title="Admin" subtitle="Moderate lenders and review all loans. Listings can be removed from Browse tools." />
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <h2 className="mb-2 text-sm font-semibold">Users</h2>
      <div className="space-y-2">
        {users?.map((u) => (
          <Card key={u.id} className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{u.name} <span className="text-xs text-stone-500">({u.role})</span></p>
              <p className="text-xs text-stone-500">{u.email}</p>
            </div>
            <Button variant={u.trustedLender ? "secondary" : "primary"} onClick={() => { setError(null); setTrusted({ userId: u.id, trusted: !u.trustedLender }).catch((e) => setError(errorMessage(e))); }}>
              {u.trustedLender ? "Remove Trusted Lender" : "Mark Trusted Lender"}
            </Button>
          </Card>
        ))}
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold">All loans</h2>
      {loans === undefined ? <p className="text-sm text-stone-500">Loading...</p> : loans.length === 0 ? <Empty>No loans yet.</Empty> : (
        <div className="space-y-3">{loans.map((l) => <LoanCard key={l.id} loan={l} as="admin" />)}</div>
      )}
    </>
  );
}
