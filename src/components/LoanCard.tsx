"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { activityLabel, errorMessage } from "@/lib/format";
import { Badge, Button, Card } from "./ui";

export type LoanView = {
  id: Id<"loans">;
  toolName: string;
  startDate: string;
  endDate: string;
  status: "requested" | "approved" | "declined" | "active" | "returned";
  overdue: boolean;
  borrowerName: string;
  lenderName: string;
  borrowerEmail?: string;
  lenderEmail?: string;
  activity: { type: string; status: string; at: number }[];
};

export function LoanCard({ loan, as }: { loan: LoanView; as: "borrower" | "lender" | "admin" }) {
  const decide = useMutation(api.loans.decide);
  const handOver = useMutation(api.loans.markHandedOver);
  const markReturned = useMutation(api.loans.markReturned);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{loan.toolName}</p>
          <p className="text-sm text-stone-600">
            {loan.startDate} to {loan.endDate} ·{" "}
            {as === "borrower" ? `from ${loan.lenderName}` : as === "lender" ? `to ${loan.borrowerName}` : `${loan.lenderName} -> ${loan.borrowerName}`}
          </p>
          {as === "admin" && <p className="text-xs text-stone-500">{loan.lenderEmail} to {loan.borrowerEmail}</p>}
        </div>
        <div className="flex gap-1.5">
          {loan.overdue && <Badge kind="overdue">overdue</Badge>}
          <Badge kind={loan.status} />
        </div>
      </div>

      {as === "lender" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {loan.status === "requested" && (
            <>
              <Button disabled={busy} onClick={() => run(() => decide({ loanId: loan.id, decision: "approved" }))}>Approve</Button>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => decide({ loanId: loan.id, decision: "declined" }))}>Decline</Button>
            </>
          )}
          {loan.status === "approved" && (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => handOver({ loanId: loan.id }))}>Mark handed over</Button>
          )}
          {(loan.status === "approved" || loan.status === "active") && (
            <Button disabled={busy} onClick={() => run(() => markReturned({ loanId: loan.id }))}>Mark returned</Button>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {loan.activity.length > 0 && (
        <ul className="mt-3 space-y-0.5 border-t border-stone-100 pt-2 text-xs text-stone-500">
          {loan.activity.map((a, i) => (
            <li key={i} className={a.status === "failed" || a.status === "dead" ? "text-red-700" : ""}>{activityLabel(a)}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
