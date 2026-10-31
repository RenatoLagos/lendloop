"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button, Empty } from "@/components/ui";

export default function Landing() {
  const tools = useQuery(api.tools.listPublic);
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">LendLoop</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Borrow what you need. Lend what you don&apos;t.</h1>
      <p className="mt-3 max-w-xl text-stone-600">
        A neighbourhood board for sharing tools. List what&apos;s gathering dust, request what you need for a weekend, and let automated reminders keep everyone on track.
      </p>
      <div className="mt-6">
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button>Sign in to lend or borrow</Button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link href="/tools"><Button>Go to the board</Button></Link>
        </Show>
      </div>

      <h2 className="mt-14 text-lg font-semibold">Available right now</h2>
      <div className="mt-3">
        {tools === undefined ? (
          <p className="text-sm text-stone-500">Loading...</p>
        ) : tools.length === 0 ? (
          <Empty>No tools listed yet. Be the first to share one.</Empty>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {tools.map((t, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{t.category}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
