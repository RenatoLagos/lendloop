"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "@/lib/format";
import { Button, inputClass } from "./ui";

export function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request({ toolId, startDate, endDate });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
      <label className="text-xs">From<input type="date" className={inputClass} min={today} required value={startDate} onChange={(e) => setStart(e.target.value)} /></label>
      <label className="text-xs">To<input type="date" className={inputClass} min={startDate} required value={endDate} onChange={(e) => setEnd(e.target.value)} /></label>
      <Button type="submit" disabled={busy}>Send request</Button>
      <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
    </form>
  );
}
