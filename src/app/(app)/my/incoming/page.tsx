"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { LoanCard } from "@/components/LoanCard";
import { Empty, PageTitle } from "@/components/ui";

export default function Incoming() {
  const loans = useQuery(api.loans.incoming);
  return (
    <>
      <PageTitle title="Incoming requests" subtitle="Neighbours asking to borrow your tools." />
      {loans === undefined ? <p className="text-sm text-stone-500">Loading...</p> : loans.length === 0 ? (
        <Empty>No requests yet.</Empty>
      ) : (
        <div className="space-y-3">{loans.map((l) => <LoanCard key={l.id} loan={l} as="lender" />)}</div>
      )}
    </>
  );
}
