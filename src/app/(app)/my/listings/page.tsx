"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge, Button, Card, Empty, PageTitle } from "@/components/ui";
import { ToolForm } from "@/components/ToolForm";
import { errorMessage } from "@/lib/format";

export default function MyListings() {
  const tools = useQuery(api.tools.mine);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageTitle title="My listings" subtitle="Tools you are willing to lend." />
      <h2 className="mb-2 text-sm font-semibold">List a tool</h2>
      <ToolForm />
      <h2 className="mb-2 mt-8 text-sm font-semibold">Your tools</h2>
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      {tools === undefined ? <p className="text-sm text-stone-500">Loading...</p> : tools.length === 0 ? (
        <Empty>You have not listed anything yet.</Empty>
      ) : (
        <div className="space-y-3">
          {tools.map((t) =>
            editing === t.id ? (
              <ToolForm key={t.id} initial={{ id: t.id, name: t.name, category: t.category, condition: t.condition, description: t.description }} onDone={() => setEditing(null)} />
            ) : (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-stone-500">{t.category} · {t.condition}</p>
                    {t.description && <p className="mt-1 text-sm text-stone-700">{t.description}</p>}
                  </div>
                  <Badge kind={t.availability} />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(t.id)}>Edit</Button>
                  <Button variant="danger" onClick={() => { setError(null); remove({ toolId: t.id }).catch((e) => setError(errorMessage(e))); }}>Delete</Button>
                </div>
              </Card>
            ),
          )}
        </div>
      )}
    </>
  );
}
