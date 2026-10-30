"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Gamepad2 } from "lucide-react";
import { Badge, Card, CardContent, Input, Select } from "@/components/ui/primitives";
import type { Narrative } from "@/lib/domain";
import { classifyWeb3GameSignal, extractWeb3GameChain } from "@/lib/classification";
import { timeAgo } from "@/lib/format";

const signalTypes = ["game-launch", "playtest", "play-to-earn", "onchain-game", "gamefi", "gaming-update", "unknown"] as const;
const signalLabel = (value: string) => value.replaceAll("-", " ");
const chainLabel = (value: string) => ({ bsc: "BNB Chain", zksync: "zkSync" }[value] ?? `${value.charAt(0).toUpperCase()}${value.slice(1)}`);

export function Web3GamesBoard({ narratives }: { narratives: Narrative[] }) {
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState("all");
  const [type, setType] = useState("all");
  const signals = useMemo(() => narratives.flatMap((narrative) => narrative.sourcePosts.map((sourcePost, index) => ({
    id: `${narrative.id}:${sourcePost.externalId ?? sourcePost.sourceUrl ?? index}`,
    sourcePost,
    discoveredAt: narrative.lastUpdatedAt,
    signalType: classifyWeb3GameSignal(sourcePost.text),
    chain: extractWeb3GameChain(sourcePost.text),
  }))), [narratives]);
  const chains = useMemo(() => [...new Set(signals.map((item) => item.chain).filter((value): value is string => Boolean(value)))].sort(), [signals]);
  const filtered = useMemo(() => signals.filter((item) => {
    const content = `${item.signalType} ${item.chain ?? ""} ${item.sourcePost.author ?? ""} ${item.sourcePost.text}`.toLowerCase();
    return (chain === "all" || item.chain === chain) && (type === "all" || item.signalType === type) && (!query.trim() || content.includes(query.trim().toLowerCase()));
  }), [signals, chain, type, query]);

  return <>
    <div className="mb-6">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">Social discovery · unverified</div>
      <h1 className="text-2xl font-semibold tracking-tight text-white md:text-[28px]">Web3 Games</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-400">Recent Web3 gaming signals found through the configured X searches. Each item links to its original post.</p>
    </div>
    <div className="mb-4 flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs leading-5 text-amber-100/80">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
      <span>Discovery only: social posts and chain mentions are not independently verified. This feed does not audit game contracts, confirm official project status, or assess game safety.</span>
    </div>
    <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_190px]">
      <Input aria-label="Search game signals" placeholder="Search post text or account" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Select aria-label="Filter game signals by chain" value={chain} onChange={(event) => setChain(event.target.value)}>
        <option value="all">All chains</option>
        {chains.map((item) => <option key={item} value={item}>{chainLabel(item)}</option>)}
      </Select>
      <Select aria-label="Filter game signals by type" value={type} onChange={(event) => setType(event.target.value)}>
        <option value="all">All signal types</option>
        {signalTypes.map((item) => <option key={item} value={item}>{signalLabel(item)}</option>)}
      </Select>
    </div>
    <div aria-live="polite" className="mb-3 text-xs text-slate-500">{filtered.length} signal{filtered.length === 1 ? "" : "s"} · sorted by source post time</div>
    {filtered.length ? <div className="space-y-3">{filtered.map((item) => <Card key={item.id}>
      <CardContent className="p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="blue">{signalLabel(item.signalType)}</Badge>
          {item.chain ? <Badge tone="neutral">{chainLabel(item.chain)}</Badge> : <Badge tone="neutral">Chain unreported</Badge>}
          <span className="ml-auto text-[10px] text-slate-500">{timeAgo(item.sourcePost.publishedAt ?? item.discoveredAt)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{item.sourcePost.text}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
          <span className="text-xs text-slate-500">{item.sourcePost.author ? `@${item.sourcePost.author}` : "Source account unavailable"}</span>
          {item.sourcePost.sourceUrl?.startsWith("https://") ? <a className="text-xs text-emerald-300 hover:text-emerald-200" href={item.sourcePost.sourceUrl} target="_blank" rel="noreferrer">Open original X post ↗</a> : <span className="text-xs text-slate-600">Source link unavailable</span>}
        </div>
      </CardContent>
    </Card>)}</div> : <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-10 text-center">
      <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-slate-400"><Gamepad2 size={20} /></div>
      <h2 className="text-sm font-medium text-slate-200">{signals.length ? "No matching game signals" : "No game signals yet"}</h2>
      <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{signals.length ? "Try a different search term or filter." : "Signals appear after the configured worker runs a successful X search and the batch is saved."}</p>
    </div>}
  </>;
}
