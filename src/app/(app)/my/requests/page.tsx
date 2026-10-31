"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { LoanCard } from "@/components/LoanCard";
import { Empty, PageTitle } from "@/components/ui";

export default function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  return (
    <>
      <PageTitle title="My requests" subtitle="Tools you asked to borrow." />
      {loans === undefined ? <p className="text-sm text-stone-500">Loading...</p> : loans.length === 0 ? (
        <Empty>You have not requested anything yet. Browse the board to find a tool.</Empty>
      ) : (
        <div className="space-y-3">{loans.map((l) => <LoanCard key={l.id} loan={l} as="borrower" />)}</div>
      )}
    </>
  );
}
