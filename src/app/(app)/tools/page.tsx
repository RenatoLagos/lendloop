"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CATEGORIES, type Category } from "../../../../convex/lib/categories";
import { Badge, Button, Card, Empty, PageTitle, inputClass } from "@/components/ui";
import { RequestForm } from "@/components/RequestForm";
import { errorMessage } from "@/lib/format";

export default function ToolsPage() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const me = useQuery(api.users.me);
  const remove = useMutation(api.tools.remove);
  const [requesting, setRequesting] = useState<Id<"tools"> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageTitle title="Browse tools" subtitle="Everything your neighbours are willing to lend." />
      <div className="mb-4 flex items-center gap-2 text-sm">
        <label htmlFor="cat" className="font-medium">Category</label>
        <select id="cat" className={`${inputClass} max-w-48`} value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {notice && <p role="status" className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">{notice}</p>}
      {tools === undefined ? <p className="text-sm text-stone-500">Loading...</p> : tools.length === 0 ? (
        <Empty>No tools in this category yet.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => {
            const own = t.ownerId === me?.id;
            return (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-stone-500">{t.category} · {t.condition}</p>
                  </div>
                  <Badge kind={t.availability} />
                </div>
                {t.description && <p className="mt-2 text-sm text-stone-700">{t.description}</p>}
                <p className="mt-2 text-xs text-stone-500">
                  {own ? "Your listing" : t.ownerName}
                  {t.ownerTrusted && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">Trusted Lender</span>}
                </p>
                {/* Wait for users.me so own tools never flash "Request to borrow". */}
                {me !== undefined && <div className="mt-3 flex gap-2">
                  {!own && t.availability !== "on_loan" && requesting !== t.id && (
                    <Button onClick={() => setRequesting(t.id)}>Request to borrow</Button>
                  )}
                  {me?.role === "admin" && !own && (
                    <Button variant="danger" onClick={() => remove({ toolId: t.id }).catch((e) => setNotice(errorMessage(e)))}>Remove (admin)</Button>
                  )}
                </div>}
                {requesting === t.id && (
                  <RequestForm toolId={t.id} onDone={() => { setRequesting(null); setNotice("Request sent. The lender has been notified."); }} />
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
