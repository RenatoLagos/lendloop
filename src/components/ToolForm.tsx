"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, LIMITS, type Category, type Condition } from "../../convex/lib/categories";
import { errorMessage } from "@/lib/format";
import { Button, Card, inputClass } from "./ui";

export type ToolDraft = { id?: Id<"tools">; name: string; category: Category; condition: Condition; description: string };
const EMPTY: ToolDraft = { name: "", category: "power tools", condition: "good", description: "" };

export function ToolForm({ initial, onDone }: { initial?: ToolDraft; onDone?: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [draft, setDraft] = useState<ToolDraft>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id, ...fields } = draft;
      if (id) await update({ toolId: id, ...fields });
      else await create(fields);
      if (!id) setDraft(EMPTY);
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Name</span>
          <input className={inputClass} required maxLength={LIMITS.name} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Category</span>
          <select className={inputClass} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Condition</span>
          <select className={inputClass} value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value as Condition })}>
            {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Short description</span>
          <textarea className={inputClass} rows={2} maxLength={LIMITS.description} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>{draft.id ? "Save changes" : "List tool"}</Button>
          {onDone && <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>}
        </div>
      </form>
    </Card>
  );
}
