"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Server } from "lucide-react";
import { Badge, Card, CardContent, Input, Select } from "@/components/ui/primitives";
import type { Narrative } from "@/lib/domain";
import { FREE_VPS_CATEGORY, getFreeVpsSignals } from "@/lib/free-vps";
import { timeAgo } from "@/lib/format";

export function FreeVpsBoard({ narratives }: { narratives: Narrative[] }) {
  const [query, setQuery] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "all">("today");
  const signals = useMemo(() => getFreeVpsSignals(narratives, { includeOlder: dateRange === "all" }), [narratives, dateRange]);
  const filtered = useMemo(() => signals.filter(({ post }) =>
    `${post.author ?? ""} ${post.text}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [signals, query]);

  return <>
    <div className="mb-6">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">X post discovery · unverified</div>
      <h1 className="text-2xl font-semibold tracking-tight text-white md:text-[28px]">Free VPS</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-400">Posts matching searches for free VPS, VPS giveaways, free cloud servers, free trials, and “VPS gratis”. This is a feed of X posts—not a provider directory.</p>
    </div>
    <div className="mb-4 flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs leading-5 text-amber-100/80">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
      <span>Discovery only: offers, account ownership, terms, and availability have not been independently verified. Check the original post and provider before signing up; do not send passwords, payment details, or wallet credentials to an account based only on a post.</span>
    </div>
    <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
      <Input aria-label="Search Free VPS posts" placeholder="Search post text or account" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Select aria-label="Filter Free VPS posts by date" value={dateRange} onChange={(event) => setDateRange(event.target.value as "today" | "all")}>
        <option value="today">Published today (Jakarta)</option>
        <option value="all">All stored dates</option>
      </Select>
    </div>
    <div aria-live="polite" className="mb-3 text-xs text-slate-500">{filtered.length} post{filtered.length === 1 ? "" : "s"} · newest first · {FREE_VPS_CATEGORY}</div>
    {filtered.length ? <div className="space-y-3">{filtered.map(({ id, post, discoveredAt }) => <Card key={id}>
      <CardContent className="p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="blue">X post</Badge>
          <span className="ml-auto text-[10px] text-slate-500">{timeAgo(post.publishedAt ?? discoveredAt)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{post.text}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
          <span className="text-xs text-slate-500">{post.author ? `@${post.author}` : "Source account unavailable"}</span>
          {post.sourceUrl?.startsWith("https://") ? <a className="text-xs text-emerald-300 hover:text-emerald-200" href={post.sourceUrl} target="_blank" rel="noreferrer">Open original X post ↗</a> : <span className="text-xs text-slate-600">Source link unavailable</span>}
        </div>
      </CardContent>
    </Card>)}</div> : <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-10 text-center">
      <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-slate-400"><Server size={20} /></div>
      <h2 className="text-sm font-medium text-slate-200">{signals.length ? "No matching VPS posts" : "No VPS posts for this date"}</h2>
      <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{signals.length ? "Try a different search term or date filter." : "Posts appear after the configured worker successfully searches X and saves a batch. The default view only includes posts published today in Jakarta time."}</p>
    </div>}
  </>;
}
