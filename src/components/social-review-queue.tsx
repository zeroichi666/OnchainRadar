"use client";

import { useMemo, useState } from "react";
import type { SocialClaimReview } from "@/lib/domain";
import { formatDate, formatNumber } from "@/lib/format";
import { filterSocialClaimsForDay } from "@/lib/social-review";
import { todayInTimeZone } from "@/lib/local-day";
import { Button, Input } from "@/components/ui/primitives";

const areaLabel: Record<SocialClaimReview["candidateAreas"][number], string> = {
  "free-mint": "Free Mint claim detected",
  "gtd-mint": "GTD Mint claim detected",
  cto: "CTO claim detected",
  "meme-coin": "Public meme-call signal",
};
const signalLabel: Record<SocialClaimReview["claimSignals"][number], string> = {
  "free-mint-wording": "Free Mint wording detected",
  "gtd-wording": "GTD wording detected",
  "fcfs-wording": "FCFS wording detected",
  "giveaway-wording": "Giveaway wording detected",
  "meme-token-mentioned": "Meme ticker/token mentioned",
  "public-meme-call-wording": "Public call wording detected",
  "cto-wording": "CTO wording detected",
};

export function SocialReviewCard({ item }: { item: SocialClaimReview }) {
  return <article data-testid="social-review-card" className="rounded-xl border border-amber-300/15 bg-amber-300/[0.025] p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-medium text-slate-100">{item.label}</h3>
      <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">Detected claim · wording only</span>
      {item.candidateAreas.map((area) => <span key={area} className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-slate-300">{areaLabel[area]}</span>)}
    </div>
    {(item.tickers.length > 0 || item.contractAddresses.length > 0 || item.chainClaims.length > 0) && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-slate-400">
      {item.tickers.length > 0 && <span>Tickers in posts: {item.tickers.map((ticker) => `$${ticker}`).join(", ")}</span>}
      {item.chainClaims.length > 0 && <span>Chains mentioned: {item.chainClaims.join(", ")}</span>}
      {item.contractAddresses.map((address) => <span key={address} className="break-all">Address string in source: <code>{address}</code></span>)}
    </div>}
    <div className="mt-3 flex flex-wrap gap-2">
      {item.claimSignals.map((signal) => <span key={signal} className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] text-amber-100/75">{signalLabel[signal]}</span>)}
    </div>
    <div className="mt-3 text-[10px] text-slate-500">
      {item.sourcePosts.length} unique X source{item.sourcePosts.length === 1 ? "" : "s"} · {item.sourceStatus === "available" ? "all source links available" : item.sourceStatus === "partial" ? "some source links unavailable" : "source links unavailable"}
      {item.originCategories.length > 0 && ` · ${item.originCategories.join(", ")}`}
      {item.originQueries.length > 0 && ` · query: ${item.originQueries.join(", ")}`}
    </div>
    <div className="mt-3 space-y-3">
      {item.sourcePosts.map((post, index) => {
        const sourceLink = post.sourceUrl?.startsWith("https://") ? post.sourceUrl : undefined;
        const postKey = post.externalId ?? post.sourceUrl ?? `${post.author ?? "source"}-${post.publishedAt ?? index}`;
        return <div key={postKey} className="rounded-xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span className="font-medium text-slate-300">{post.author ? `@${post.author}` : "Unknown X author"}</span>
            <span>Post ID: {post.externalId ?? "not provided"}</span>
            <span>Posted: {formatDate(post.publishedAt)}</span>
            {post.likes != null && <span>{formatNumber(post.likes)} likes</span>}
            {post.reposts != null && <span>{formatNumber(post.reposts)} reposts</span>}
            {post.replies != null && <span>{formatNumber(post.replies)} replies</span>}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{post.text}</p>
          <div className="mt-2 text-xs">
            {sourceLink
              ? <a className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200" href={sourceLink} target="_blank" rel="noreferrer">Open original X post</a>
              : <span className="text-amber-200/80">X source link unavailable</span>}
          </div>
        </div>;
      })}
    </div>
    <p className="mt-3 text-[10px] leading-4 text-slate-500">Text-signal grouping only; project terms, token identity, mint access, and CTO claims are not verified here.</p>
  </article>;
}

export function SocialReviewSection({ items, area, initialDate }: { items: SocialClaimReview[]; area: SocialClaimReview["candidateAreas"][number] | "all"; initialDate?: string }) {
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? todayInTimeZone());
  const dayItems = useMemo(() => selectedDate ? filterSocialClaimsForDay(items, selectedDate) : items, [items, selectedDate]);
  const reviews = area === "all" ? dayItems : dayItems.filter((item) => item.candidateAreas.includes(area));
  const title = area === "all" ? "Detected X claim groups" : areaLabel[area];
  const sourceCount = reviews.reduce((count, item) => count + item.sourcePosts.length, 0);
  const noMatchMessage = area === "cto" ? "No explicit CTO wording was detected" : "No matching claim wording was detected";
  const emptyMessage = selectedDate
    ? `${noMatchMessage} in stored X posts published on ${selectedDate} WIB. Older posts are still saved; choose All history to view them.`
    : `${noMatchMessage} in the currently stored X posts.`;
  return <section aria-label={title} className="mt-6 rounded-2xl border border-amber-300/15 bg-amber-300/[0.02] p-4 md:p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-amber-100">{title}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Claims are detected from source wording and grouped by project, ticker, or matching contract string. They are not factual confirmations. {selectedDate ? `Showing posts published on ${selectedDate} WIB; older stored posts are preserved.` : "Showing all stored dates."}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[10px] text-slate-500">Date (WIB)<Input aria-label="Filter social posts by date (WIB)" className="h-9 w-36" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}/></label>
        <Button size="sm" variant="secondary" onClick={() => setSelectedDate(todayInTimeZone())}>Today · WIB</Button>
        <Button size="sm" variant={selectedDate ? "ghost" : "primary"} onClick={() => setSelectedDate("")}>All history</Button>
      </div>
    </div>
    <div className="mb-4"><span className="rounded-full bg-amber-300/[0.08] px-2.5 py-1 text-[10px] text-amber-200">{reviews.length} grouped record{reviews.length === 1 ? "" : "s"} · {sourceCount} source post{sourceCount === 1 ? "" : "s"}</span></div>
    {reviews.length ? <div className="space-y-3">{reviews.map((item) => <SocialReviewCard key={item.id} item={item}/>)}</div> : <p className="rounded-xl border border-dashed border-white/[0.08] px-4 py-5 text-xs leading-5 text-slate-500">{emptyMessage}</p>}
  </section>;
}
