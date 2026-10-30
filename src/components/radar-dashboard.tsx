"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, Bookmark, CalendarDays, Gamepad2,
  CheckCircle2, ChevronLeft, ChevronRight, Clock3, Command, ExternalLink, Filter, Flame, Gauge,
  Globe2, Grid2X2, Home, Layers3, LockKeyhole, Menu, Radar, RefreshCw, Search, Settings2,
  Server, Shield, ShieldAlert, SlidersHorizontal, Sparkles, Target, TrendingUp, Wallet, X, Zap,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from "@/components/ui/primitives";
import { DashboardPayloadSchema, type DashboardPayload, type GtdOpportunity, type Narrative, type NftOpportunity, type SecurityReport, type TokenCandidate } from "@/lib/domain";
import { formatDate, formatNumber, formatPercent, formatUsd, shortAddress, chainLabel, timeAgo } from "@/lib/format";
import { scoreApprovedToken } from "@/lib/scoring";
import { defaultClientSettings, RadarClientSettingsSchema, type RadarClientSettings } from "@/lib/settings";
import { AUTO_REFRESH_MS, DASHBOARD_TIMEOUT_MS, hasDashboardRecords } from "@/lib/dashboard-refresh";
import { SocialReviewSection } from "@/components/social-review-queue";
import { Web3GamesBoard } from "@/components/web3-games-board";
import { FreeVpsBoard } from "@/components/free-vps-board";
import { ScanHistoryDangerZone } from "@/components/scan-history-danger-zone";

const navItems = [
  { name: "Overview", icon: Home }, { name: "Mint Scanner", icon: Layers3 },
  { name: "Meme Coins", icon: Flame }, { name: "Web3 Games", icon: Gamepad2 }, { name: "Free VPS", icon: Server }, { name: "Community Takeover", icon: UsersIcon }, { name: "X Narratives", icon: TrendingUp },
  { name: "Security Review", icon: ShieldAlert }, { name: "Watchlist", icon: Bookmark }, { name: "Settings", icon: Settings2 },
];
function UsersIcon(props: React.ComponentProps<typeof Activity>) { return <Globe2 {...props} />; }
const chainOptions = ["solana", "ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"];
const chartColors = ["#55e7a4", "#53b7ff", "#c18cff", "#ffba66", "#ff718e", "#67d8d3", "#a5b4fc"];
const watchKey = "onchain-radar.watchlist.v1";
const settingsKey = "onchain-radar.settings.v1";

type Health = { mode?: string; services?: { name: string; status: string; detail?: string }[]; warnings?: string[] };

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "yellow" | "red" | "blue" | "purple" }) {
  return <Badge tone={tone}>{children}</Badge>;
}
function securityTone(verdict?: string): "green" | "yellow" | "red" | "neutral" {
  if (verdict === "PASS") return "green";
  if (verdict === "WARNING") return "yellow";
  if (verdict === "FAIL") return "red";
  return "neutral";
}
function statusTone(status: string): "green" | "yellow" | "red" | "blue" | "purple" | "neutral" {
  const value = status.toLowerCase();
  if (["verified", "officially-confirmed", "live", "free"].includes(value)) return "green";
  if (["pending", "unverified", "unknown", "third-party-reported", "probable"].includes(value)) return "yellow";
  if (["rejected", "disputed", "expired", "ended", "fail", "potentially-misleading"].includes(value)) return "red";
  if (["upcoming", "pass"].includes(value)) return "blue";
  return "neutral";
}
function ExternalSource({ href, children = "Original source" }: { href?: string; children?: React.ReactNode }) {
  if (!href || !href.startsWith("https://")) return <span className="text-xs text-slate-600">Source link unavailable</span>;
  return <a className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200" href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={12} /></a>;
}
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">{eyebrow}</div><h1 className="text-2xl font-semibold tracking-tight text-white md:text-[28px]">{title}</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p></div>{action}</div>;
}
function EmptyState({ icon: Icon = Activity, title, detail }: { icon?: React.ElementType; title: string; detail: string }) {
  return <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-10 text-center"><div className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-slate-400"><Icon size={20} /></div><h3 className="text-sm font-medium text-slate-200">{title}</h3><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{detail}</p></div>;
}
function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return <div className="mb-5 space-y-2">{warnings.map((warning, index) => <div key={`${warning}-${index}`} className="flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs leading-5 text-amber-100/80"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300"/><span>{warning}</span></div>)}</div>;
}
function MetricCard({ label, value, hint, icon: Icon, accent = "text-emerald-300" }: { label: string; value: string | number; hint: string; icon: React.ElementType; accent?: string }) {
  return <Card className="metric-card"><CardContent className="p-4 md:p-5"><div className="flex items-start justify-between"><div><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">{value}</div><div className="mt-1 text-[11px] text-slate-500">{hint}</div></div><div className={`rounded-lg border border-white/[0.06] bg-white/[0.025] p-2 ${accent}`}><Icon size={16}/></div></div></CardContent></Card>;
}
function SourceHealth({ health, payload }: { health: Health | null; payload: DashboardPayload }) {
  const services = health?.services ?? [
    { name: "Agent-Reach / X", status: payload.lastSuccessfulSocialSyncAt ? (Date.now() - Date.parse(payload.lastSuccessfulSocialSyncAt) < 6 * 3600000 ? "connected" : "stale") : "not configured", detail: payload.lastSuccessfulSocialSyncAt ? `Last sync ${timeAgo(payload.lastSuccessfulSocialSyncAt)}` : "No successful worker sync" },
    { name: "DEX Screener", status: payload.tokens.length ? "available" : "waiting", detail: payload.tokens.length ? "Market data attached to approved candidates" : "Waiting for candidate addresses" },
    { name: "Security analysis", status: payload.securityReports.length ? "active" : "waiting", detail: `${payload.securityReports.length} cached assessment(s)` },
    { name: "Supabase", status: payload.mode === "live" ? "configured" : "demo", detail: payload.mode === "live" ? "Live persistence mode" : "Demo response; no live database attached" },
  ];
  return <div className="space-y-3">{services.map((service) => {
    const good = ["connected", "available", "active", "configured"].includes(service.status.toLowerCase());
    const caution = ["stale", "waiting", "demo"].includes(service.status.toLowerCase());
    return <div key={service.name} className="flex items-start gap-3"><span className={`mt-1.5 size-1.5 rounded-full ${good ? "bg-emerald-300" : caution ? "bg-amber-300" : "bg-rose-400"}`} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-300">{service.name}</span><span className={`text-[10px] uppercase tracking-wider ${good ? "text-emerald-300" : caution ? "text-amber-300" : "text-rose-300"}`}>{service.status}</span></div><p className="mt-0.5 truncate text-[11px] text-slate-500">{service.detail ?? "No additional status"}</p></div></div>;
  })}</div>;
}
function StatChart({ tokens }: { tokens: TokenCandidate[] }) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(chainLabel(token.chain), (counts.get(chainLabel(token.chain)) ?? 0) + 1);
    return [...counts.entries()].map(([name, value]) => ({ name, value }));
  }, [tokens]);
  return data.length ? <div className="h-52 w-full"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={78} paddingAngle={4} stroke="transparent">{data.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip contentStyle={{ background: "#111820", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, color: "#e2e8f0", fontSize: 12 }} /></PieChart></ResponsiveContainer><div className="flex flex-wrap justify-center gap-x-3 gap-y-1">{data.map((entry, index) => <span key={entry.name} className="flex items-center gap-1.5 text-[10px] text-slate-400"><i className="size-1.5 rounded-full" style={{ background: chartColors[index % chartColors.length] }}/>{entry.name} <b className="font-medium text-slate-200">{entry.value}</b></span>)}</div></div> : <EmptyState title="No eligible tokens yet" detail="This chart is derived only from tokens that passed the server-side security and liquidity gate." />;
}
function SourceLinks({ posts }: { posts: { sourceUrl?: string; text: string }[] }) {
  const links = posts.filter((post) => post.sourceUrl).slice(0, 3);
  return links.length ? <div className="flex flex-wrap gap-x-3 gap-y-1">{links.map((post, index) => <ExternalSource key={post.sourceUrl} href={post.sourceUrl}>{`Source ${index + 1}`}</ExternalSource>)}</div> : <span className="text-xs text-slate-600">No source links recorded</span>;
}
function OpportunityCard({ row, isGtd = false, saved, onToggle }: { row: NftOpportunity | GtdOpportunity; isGtd?: boolean; saved: boolean; onToggle: () => void }) {
  const nft = row as NftOpportunity;
  const gtd = row as GtdOpportunity;
  const title = row.name;
  const mintAt = row.mintAt;
  const kindLabel = isGtd ? gtd.status.replaceAll("-", " ") : nft.kind === "free" ? ((nft.platformFeeUsd ?? 0) > 0 ? "Free + platform fee" : "Free + network gas") : nft.kind.replaceAll("-", " ");
  const price = isGtd ? (gtd.mintPriceUsd == null ? "Price unreported" : formatUsd(gtd.mintPriceUsd)) : (nft.mintPriceUsd == null ? "Price unreported" : formatUsd(nft.mintPriceUsd));
  return <Card className="overflow-hidden"><CardContent className="p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><Pill tone={statusTone(kindLabel)}>{kindLabel}</Pill><Pill tone="neutral">{chainLabel(row.chain)}</Pill>{!isGtd && <Pill tone={statusTone(nft.status)}>{nft.status}</Pill>}{row.demo && <Pill tone="purple">Demo</Pill>}</div><h3 className="text-base font-semibold text-slate-100">{title}</h3><p className="mt-1 text-xs text-slate-500">{isGtd ? `Allocation: ${gtd.allocation ?? "Not reported"}` : `${price} · Eligibility: ${nft.eligibility ?? "Not reported"}`}</p></div><Button size="icon" variant="ghost" aria-label={saved ? "Remove from watchlist" : "Add to watchlist"} onClick={onToggle}><Bookmark size={16} className={saved ? "fill-emerald-300 text-emerald-300" : ""}/></Button></div><div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 text-xs sm:grid-cols-3"><div><span className="text-slate-600">Mint time</span><p className="mt-1 text-slate-300">{mintAt ? `${new Date(mintAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : "Not confirmed"}</p></div><div><span className="text-slate-600">{isGtd ? "Conditions" : "Network fee estimate"}</span><p className="mt-1 text-slate-300">{isGtd ? (gtd.conditions.join(" · ") || gtd.eligibility || "Not reported") : formatUsd(nft.networkFeeEstimateUsd)}</p></div><div><span className="text-slate-600">Verification</span><p className="mt-1 text-slate-300">{isGtd ? `Checked ${timeAgo(gtd.lastCheckedAt)} · confidence ${gtd.confidence}%` : `${nft.securityStatus} · confidence ${nft.confidence}%`}</p></div></div><div className="mt-3"><SourceLinks posts={row.sourcePosts}/></div>{!isGtd && nft.mintAt && <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500"><Clock3 size={12}/>Countdown only available for a confirmed start time; scheduled time shown in UTC.</div>}</CardContent></Card>;
}
function MonthCalendar({ dates, onChoose }: { dates: string[]; onChoose: (date: string) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState("");
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const counts = new Map<string, number>();
  for (const date of dates) { const key = new Date(date).toISOString().slice(0, 10); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  return <Card><CardHeader><div><CardTitle>Mint calendar</CardTitle><p className="mt-1 text-xs text-slate-500">Scheduled times are interpreted and displayed in UTC.</p></div><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} aria-label="Previous month"><ChevronLeft size={15}/></Button><Button size="icon" variant="ghost" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} aria-label="Next month"><ChevronRight size={15}/></Button></div></CardHeader><CardContent><div className="mb-2 text-center text-sm font-medium text-slate-200">{month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</div><div className="grid grid-cols-7 gap-1 text-center">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <div key={day} className="py-2 text-[10px] uppercase text-slate-600">{day}</div>)}{cells.map((day, index) => { const date = day ? new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10) : ""; const count = date ? counts.get(date) ?? 0 : 0; return <button key={`${date}-${index}`} disabled={!day} onClick={() => { setSelected(date); onChoose(date); }} className={`min-h-12 rounded-lg text-xs transition ${!day ? "" : selected === date ? "bg-emerald-300 text-[#08110d]" : count ? "border border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100 hover:bg-emerald-300/15" : "text-slate-400 hover:bg-white/[0.05]"}`}><span>{day ?? ""}</span>{count > 0 && <span className="mt-0.5 block text-[9px] opacity-75">{count} event{count > 1 ? "s" : ""}</span>}</button>; })}</div></CardContent></Card>;
}

type MintCandidate = { type: "free"; row: NftOpportunity } | { type: "gtd"; row: GtdOpportunity };

function MintScannerBoard({ nfts, gtd, saved, toggleSave }: { nfts: NftOpportunity[]; gtd: GtdOpportunity[]; saved: string[]; toggleSave: (id: string) => void }) {
  const [category, setCategory] = useState<"all" | "free" | "gtd">("all");
  const [view, setView] = useState<"table" | "calendar">("table");
  const [chain, setChain] = useState("all");
  const [status, setStatus] = useState("all");
  const [verification, setVerification] = useState("all");
  const [eligibility, setEligibility] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const candidates: MintCandidate[] = [
    ...nfts.filter((item) => ["free", "conditional-free", "low-cost", "unknown"].includes(item.kind)).map((row) => ({ type: "free" as const, row })),
    ...gtd.map((row) => ({ type: "gtd" as const, row })),
  ];
  const categoryRows = category === "all" ? candidates : candidates.filter((item) => item.type === category);
  const filtered = categoryRows.filter(({ type, row }) => {
    const chainMatch = chain === "all" || row.chain === chain;
    const rowStatus = row.status;
    const statusMatch = status === "all" || rowStatus === status;
    const verificationValue = type === "free" ? row.securityStatus : row.status;
    const verificationMatch = verification === "all" || verificationValue === verification;
    const eligibilityValue = type === "free" ? (row.eligibilityType ?? "unknown") : (row.eligibility ? "conditional" : "unknown");
    const eligibilityMatch = eligibility === "all" || eligibilityValue === eligibility;
    const date = row.mintAt ? Date.parse(row.mintAt) : null;
    const fromMatch = !from || (date != null && date >= Date.parse(`${from}T00:00:00Z`));
    const toMatch = !to || (date != null && date <= Date.parse(`${to}T23:59:59Z`));
    const selectedMatch = !selectedDate || row.mintAt?.slice(0, 10) === selectedDate;
    return chainMatch && statusMatch && verificationMatch && eligibilityMatch && fromMatch && toMatch && selectedMatch;
  });
  const sorted = [...filtered].sort((a, b) => {
    const direction = sortOrder === "asc" ? 1 : -1;
    const aDate = a.row.mintAt ? Date.parse(a.row.mintAt) : Number.NaN;
    const bDate = b.row.mintAt ? Date.parse(b.row.mintAt) : Number.NaN;
    const aHasSchedule = Number.isFinite(aDate);
    const bHasSchedule = Number.isFinite(bDate);
    if (aHasSchedule && bHasSchedule) return (aDate - bDate) * direction;
    if (aHasSchedule) return -1;
    if (bHasSchedule) return 1;

    const aHistory = a.type === "free"
      ? Date.parse(a.row.lastVerifiedAt ?? a.row.discoveredAt)
      : Date.parse(a.row.lastCheckedAt);
    const bHistory = b.type === "free"
      ? Date.parse(b.row.lastVerifiedAt ?? b.row.discoveredAt)
      : Date.parse(b.row.lastCheckedAt);
    if (!Number.isFinite(aHistory) && !Number.isFinite(bHistory)) return a.row.name.localeCompare(b.row.name);
    if (!Number.isFinite(aHistory)) return 1;
    if (!Number.isFinite(bHistory)) return -1;
    return (aHistory - bHistory) * direction;
  });
  const statusOptions = ["upcoming", "live", "ended", "unverified", "officially-confirmed", "third-party-reported", "expired", "potentially-misleading"];
  const verificationOptions = ["verified", "unverified", "pending", "not-applicable", "officially-confirmed", "third-party-reported"];
  return <>
    <PageHeading eyebrow="NFT discovery and allocation intelligence" title="Mint Scanner" description="Free and low-cost mints and GTD allocations in one feed. Filter by category or combine both; official GTD labels still require verified project evidence." action={<div className="flex gap-2"><Button variant={view === "table" ? "primary" : "secondary"} size="sm" onClick={() => setView("table")}><Grid2X2 size={14}/>Table</Button><Button variant={view === "calendar" ? "primary" : "secondary"} size="sm" onClick={() => setView("calendar")}><CalendarDays size={14}/>Calendar</Button></div>}/>
    <div role="group" aria-label="Mint category" className="mb-4 flex flex-wrap gap-2">
      <Button size="sm" variant={category === "all" ? "primary" : "secondary"} aria-pressed={category === "all"} onClick={() => setCategory("all")}>All Mints</Button>
      <Button size="sm" variant={category === "free" ? "primary" : "secondary"} aria-pressed={category === "free"} onClick={() => setCategory("free")}>Free Mint</Button>
      <Button size="sm" variant={category === "gtd" ? "primary" : "secondary"} aria-pressed={category === "gtd"} onClick={() => setCategory("gtd")}>GTD Mint</Button>
    </div>
    <Card className="mb-5"><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7">
      <Select aria-label="Chain" value={chain} onChange={(e) => setChain(e.target.value)}><option value="all">All chains</option>{chainOptions.map((c) => <option key={c} value={c}>{chainLabel(c)}</option>)}</Select>
      <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{statusOptions.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</Select>
      <Select aria-label="Verification" value={verification} onChange={(e) => setVerification(e.target.value)}><option value="all">All verification</option>{verificationOptions.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</Select>
      <Select aria-label="Eligibility" value={eligibility} onChange={(e) => setEligibility(e.target.value)}><option value="all">All eligibility</option>{["public", "allowlist", "whitelist", "fcfs", "raffle", "conditional", "giveaway", "unknown"].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
      <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)}/>
      <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)}/>
      <Select aria-label="Sort schedule and scan history" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}><option value="asc">Ascending · earliest schedule / oldest scan</option><option value="desc">Descending · latest schedule / newest scan</option></Select>
    </CardContent></Card>
    {view === "calendar" && <div className="mb-5"><MonthCalendar dates={filtered.flatMap(({ row }) => row.mintAt ? [row.mintAt] : [])} onChoose={setSelectedDate}/></div>}
    <div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>{filtered.length} record{filtered.length === 1 ? "" : "s"} · {view === "calendar" ? "Calendar + matching opportunities" : "Table view"}</span>{selectedDate && <Button variant="ghost" size="sm" onClick={() => setSelectedDate("")}>Clear selected date <X size={12}/></Button>}</div>
    {filtered.length ? <div className="space-y-3">{sorted.map(({ type, row }) => {
      const key = `${type}:${row.id}`;
      return <div key={key} className="space-y-1"><div className="px-1"><Pill tone={type === "gtd" ? "purple" : "blue"}>{type === "gtd" ? "GTD Mint" : "Free Mint"}</Pill></div><OpportunityCard row={row} isGtd={type === "gtd"} saved={saved.includes(key)} onToggle={() => toggleSave(key)}/></div>;
    })}</div> : <EmptyState icon={category === "gtd" ? Target : Sparkles} title="No matching opportunities" detail="No records match the current filters. Empty live data is not replaced with invented mint schedules."/>}
  </>;
}

function MintBoard({ mode, nfts, gtd, saved, toggleSave }: { mode: "free" | "gtd"; nfts: NftOpportunity[]; gtd: GtdOpportunity[]; saved: string[]; toggleSave: (id: string) => void }) {
  const [view, setView] = useState<"table" | "calendar">("table");
  const [chain, setChain] = useState("all");
  const [status, setStatus] = useState("all");
  const [verification, setVerification] = useState("all");
  const [eligibility, setEligibility] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const rows = mode === "free" ? nfts.filter((item) => ["free", "conditional-free", "low-cost", "unknown"].includes(item.kind)) : gtd;
  const filtered = rows.filter((row) => {
    const d = row as NftOpportunity;
    const chainMatch = chain === "all" || row.chain === chain;
    const rowStatus = mode === "free" ? d.status : (row as GtdOpportunity).status;
    const statusMatch = status === "all" || rowStatus === status;
    const verificationMatch = verification === "all" || (mode === "free" ? d.securityStatus === verification : (row as GtdOpportunity).status === verification);
    const eligibilityValue = mode === "free" ? (d.eligibilityType ?? "unknown") : ((row as GtdOpportunity).eligibility ? "conditional" : "unknown");
    const eligibilityMatch = eligibility === "all" || eligibilityValue === eligibility;
    const date = row.mintAt ? Date.parse(row.mintAt) : null;
    const fromMatch = !from || (date != null && date >= Date.parse(`${from}T00:00:00Z`));
    const toMatch = !to || (date != null && date <= Date.parse(`${to}T23:59:59Z`));
    const selectedMatch = !selectedDate || (row.mintAt?.slice(0, 10) === selectedDate);
    return chainMatch && statusMatch && verificationMatch && eligibilityMatch && fromMatch && toMatch && selectedMatch;
  });
  const sorted = [...filtered].sort((a, b) => {
    const direction = sortOrder === "asc" ? 1 : -1;
    const aDate = a.mintAt ? Date.parse(a.mintAt) : Number.NaN;
    const bDate = b.mintAt ? Date.parse(b.mintAt) : Number.NaN;
    const aHasSchedule = Number.isFinite(aDate);
    const bHasSchedule = Number.isFinite(bDate);
    if (aHasSchedule && bHasSchedule) return (aDate - bDate) * direction;
    if (aHasSchedule) return -1;
    if (bHasSchedule) return 1;

    const aHistory = mode === "free"
      ? Date.parse((a as NftOpportunity).lastVerifiedAt ?? (a as NftOpportunity).discoveredAt)
      : Date.parse((a as GtdOpportunity).lastCheckedAt);
    const bHistory = mode === "free"
      ? Date.parse((b as NftOpportunity).lastVerifiedAt ?? (b as NftOpportunity).discoveredAt)
      : Date.parse((b as GtdOpportunity).lastCheckedAt);
    if (!Number.isFinite(aHistory) && !Number.isFinite(bHistory)) return a.name.localeCompare(b.name);
    if (!Number.isFinite(aHistory)) return 1;
    if (!Number.isFinite(bHistory)) return -1;
    return (aHistory - bHistory) * direction;
  });
  const title = mode === "free" ? "Free Mint Scanner" : "GTD Mint Scanner";
  return <><PageHeading eyebrow={mode === "free" ? "NFT discovery" : "Guaranteed allocation intelligence"} title={title} description={mode === "free" ? "Free and low-cost mints are classified from normalized price and eligibility data; unknown prices are never shown as free." : "An official GTD label requires a verified official-project source link; ordinary allowlists remain unverified."} action={<div className="flex gap-2"><Button variant={view === "table" ? "primary" : "secondary"} size="sm" onClick={() => setView("table")}><Grid2X2 size={14}/>Table</Button><Button variant={view === "calendar" ? "primary" : "secondary"} size="sm" onClick={() => setView("calendar")}><CalendarDays size={14}/>Calendar</Button></div>}/><Card className="mb-5"><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7"><Select aria-label="Chain" value={chain} onChange={(e) => setChain(e.target.value)}><option value="all">All chains</option>{chainOptions.map((c) => <option key={c} value={c}>{chainLabel(c)}</option>)}</Select><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{(mode === "free" ? ["upcoming", "live", "ended", "unverified"] : ["officially-confirmed", "third-party-reported", "unverified", "expired", "potentially-misleading"]).map((s) => <option key={s} value={s}>{s.replaceAll("-", " ")}</option>)}</Select><Select aria-label="Verification" value={verification} onChange={(e) => setVerification(e.target.value)}><option value="all">All verification</option>{(mode === "free" ? ["verified", "unverified", "pending", "not-applicable"] : ["officially-confirmed", "third-party-reported", "unverified"]).map((s) => <option key={s} value={s}>{s.replaceAll("-", " ")}</option>)}</Select><Select aria-label="Eligibility" value={eligibility} onChange={(e) => setEligibility(e.target.value)}><option value="all">All eligibility</option>{["public", "allowlist", "whitelist", "fcfs", "raffle", "conditional", "unknown"].map((s) => <option key={s} value={s}>{s}</option>)}</Select><Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)}/><Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)}/><Select aria-label="Sort schedule and scan history" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}><option value="asc">Ascending · earliest schedule / oldest scan</option><option value="desc">Descending · latest schedule / newest scan</option></Select></CardContent></Card>{view === "calendar" && <div className="mb-5"><MonthCalendar dates={filtered.flatMap((row) => row.mintAt ? [row.mintAt] : [])} onChoose={setSelectedDate}/></div>}<div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>{filtered.length} record{filtered.length === 1 ? "" : "s"} · {view === "calendar" ? "Calendar + matching opportunities" : "Table view"}</span>{selectedDate && <Button variant="ghost" size="sm" onClick={() => setSelectedDate("")}>Clear selected date <X size={12}/></Button>}</div>{filtered.length ? <div className="space-y-3">{sorted.map((row) => { const key = `${mode}:${row.id}`; return <OpportunityCard key={key} row={row} isGtd={mode === "gtd"} saved={saved.includes(key)} onToggle={() => toggleSave(key)}/>; })}</div> : <EmptyState icon={mode === "free" ? Sparkles : Target} title="No matching opportunities" detail="No records match the current filters. Empty live data is not replaced with invented mint schedules."/>}</>;
}

function MemeTable({ tokens, reports, saved, toggleSave }: { tokens: TokenCandidate[]; reports: SecurityReport[]; saved: string[]; toggleSave: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState("all");
  const [security, setSecurity] = useState("all");
  const [minimumMarketCap, setMinimumMarketCap] = useState("");
  const [period, setPeriod] = useState<"1h" | "24h">("1h");
  const [sortBy, setSortBy] = useState("score");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const reportMap = new Map(reports.map((report) => [`${report.chain}:${report.address.toLowerCase()}`, report]));
  const filtered = tokens.filter((token) => {
    const needle = query.toLowerCase();
    const matches = `${token.name} ${token.symbol} ${token.address ?? ""} ${token.narrativeCategory ?? ""}`.toLowerCase().includes(needle);
    const report = token.address ? reportMap.get(`${token.chain}:${token.address.toLowerCase()}`) : undefined;
    const verdict = report?.verdict ?? "UNKNOWN";
    const cap = Number(minimumMarketCap) || 0;
    return matches && (chain === "all" || token.chain === chain) && (security === "all" || verdict === security) && (token.metrics.marketCapUsd ?? -1) >= cap;
  }).map((token) => ({ token, score: scoreApprovedToken(token).total ?? -1 }));
  filtered.sort((a, b) => {
    if (sortBy === "market-cap") return (b.token.metrics.marketCapUsd ?? -1) - (a.token.metrics.marketCapUsd ?? -1);
    if (sortBy === "liquidity") return (b.token.metrics.liquidityUsd ?? -1) - (a.token.metrics.liquidityUsd ?? -1);
    if (sortBy === "change") return (b.token.metrics[period === "1h" ? "change1hPct" : "change24hPct"] ?? -Infinity) - (a.token.metrics[period === "1h" ? "change1hPct" : "change24hPct"] ?? -Infinity);
    if (sortBy === "name") return a.token.name.localeCompare(b.token.name);
    return b.score - a.score;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function sortButton(label: string, key: string) { return <button className="inline-flex items-center gap-1 hover:text-emerald-200" onClick={() => { setSortBy(key); setPage(1); }}>{label}<ArrowDownUp size={11}/></button>; }
  return <><PageHeading eyebrow="Security-gated discovery" title="Meme Coins" description="Only tokens passing server-side mandatory security and minimum-liquidity checks appear here. Missing metrics remain unavailable, never zero."/><Card className="mb-5"><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6"><div className="relative lg:col-span-2"><Search size={15} className="absolute left-3 top-3 text-slate-600"/><Input className="pl-9" placeholder="Search name, ticker, address, narrative" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }}/></div><Select aria-label="Chain filter" value={chain} onChange={(e) => setChain(e.target.value)}><option value="all">All chains</option>{chainOptions.map((c) => <option key={c} value={c}>{chainLabel(c)}</option>)}</Select><Select aria-label="Security filter" value={security} onChange={(e) => setSecurity(e.target.value)}><option value="all">All security</option><option value="PASS">PASS</option><option value="WARNING">WARNING</option></Select><Input aria-label="Minimum market cap" type="number" min="0" placeholder="Min market cap" value={minimumMarketCap} onChange={(e) => setMinimumMarketCap(e.target.value)}/><Select aria-label="Time range" value={period} onChange={(e) => setPeriod(e.target.value as "1h" | "24h")}><option value="1h">1 hour range</option><option value="24h">24 hour range</option></Select></CardContent></Card><Card className="overflow-hidden"><div className="table-scroll"><table className="data-table"><thead><tr><th>Token</th><th>Chain</th><th>Price</th><th>{sortButton("Market cap", "market-cap")}</th><th>{sortButton("Liquidity", "liquidity")}</th><th>1H</th><th>24H</th><th>Buy / sell</th><th>X momentum</th><th>{sortButton("Early score", "score")}</th><th>Security</th><th>CTO</th><th>Watch</th></tr></thead><tbody>{pageRows.map(({ token, score }) => { const report = token.address ? reportMap.get(`${token.chain}:${token.address.toLowerCase()}`) : undefined; const ratio = token.metrics.buys24h != null && token.metrics.sells24h != null ? `${formatNumber(token.metrics.buys24h)} / ${formatNumber(token.metrics.sells24h)}` : "—"; const savedId = `token:${token.id}`; return <tr key={token.id}><td><Link className="group flex min-w-40 items-center gap-2.5" href={`/token/${encodeURIComponent(token.chain)}/${encodeURIComponent(token.address ?? "unknown")}`}><span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-300/10 bg-emerald-300/[0.05] text-[10px] font-bold text-emerald-200">{token.symbol.slice(0, 3).toUpperCase()}</span><span><b className="block text-xs text-slate-200 group-hover:text-emerald-200">{token.name}</b><span className="text-[10px] text-slate-600">{token.symbol} · {shortAddress(token.address)}</span></span></Link></td><td><Pill tone="neutral">{chainLabel(token.chain)}</Pill></td><td>{formatUsd(token.metrics.priceUsd, 6)}</td><td>{formatUsd(token.metrics.marketCapUsd, 0)}</td><td>{formatUsd(token.metrics.liquidityUsd, 0)}</td><td className={changeClass(token.metrics.change1hPct)}>{formatPercent(token.metrics.change1hPct)}</td><td className={changeClass(token.metrics.change24hPct)}>{formatPercent(token.metrics.change24hPct)}</td><td>{ratio}</td><td>{token.socialMomentumScore == null ? "—" : `${token.socialMomentumScore}/100`}</td><td><span className="font-medium text-slate-200">{score < 0 ? "—" : score.toFixed(0)}</span></td><td><Pill tone={securityTone(report?.verdict)}>{report?.verdict ?? "UNKNOWN"}</Pill>{report?.flags?.length ? <span className="ml-1 inline-block text-[10px] text-amber-300">{report.flags.length} flag(s)</span> : null}</td><td><Pill tone={statusTone(token.ctoStatus)}>{token.ctoStatus}</Pill></td><td><Button size="icon" variant="ghost" aria-label="Toggle watchlist" onClick={() => toggleSave(savedId)}><Bookmark size={14} className={saved.includes(savedId) ? "fill-emerald-300 text-emerald-300" : ""}/></Button></td></tr>; })}</tbody></table></div>{pageRows.length === 0 && <div className="p-5"><EmptyState icon={Flame} title="No approved tokens match" detail="The primary feed contains only addresses that passed the security policy. Check the Security Review queue for incomplete checks."/></div>}<div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3 text-xs text-slate-500"><span>{filtered.length} approved result{filtered.length === 1 ? "" : "s"} · page {currentPage} of {pages}</span><div className="flex items-center gap-2"><Select aria-label="Rows per page" className="h-8" value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value="10">10 / page</option><option value="25">25 / page</option><option value="50">50 / page</option></Select><Button size="icon" variant="ghost" disabled={currentPage <= 1} aria-label="Previous page" onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15}/></Button><Button size="icon" variant="ghost" disabled={currentPage >= pages} aria-label="Next page" onClick={() => setPage((value) => Math.min(pages, value + 1))}><ChevronRight size={15}/></Button></div></div></Card><div className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-500"><LockKeyhole size={13} className="mt-0.5 shrink-0"/>Rank is calculated only after the security gate. Score weights: social momentum 20%, narrative 20%, liquidity 20%, holder distribution 15%, market activity 15%, early discovery 10%; missing dimensions are omitted and remaining weights renormalized.</div></>;
}
function changeClass(value?: number | null) { return value == null ? "text-slate-500" : value > 0 ? "text-emerald-300" : value < 0 ? "text-rose-300" : "text-slate-400"; }
function CtoBoard({ tokens, claims, reports }: { tokens: TokenCandidate[]; claims: DashboardPayload["ctoClaims"]; reports: SecurityReport[] }) {
  const active = tokens.filter((token) => token.ctoStatus === "verified" || token.ctoStatus === "probable");
  const reportMap = new Map(reports.map((report) => [`${report.chain}:${report.address.toLowerCase()}`, report]));
  return <><PageHeading eyebrow="Community takeover verification" title="Community Takeover" description="A takeover label never bypasses token security. Only verified or probable claims with passing security enter the confirmed section."/><div className="mb-5 grid gap-3 md:grid-cols-3"><MetricCard label="Security-cleared CTOs" value={active.length} hint="Verified/probable and approved" icon={CheckCircle2}/><MetricCard label="Claims under review" value={claims.length} hint="Not represented as confirmed" icon={AlertTriangle} accent="text-amber-300"/><MetricCard label="Verification model" value="Evidence-led" hint="Independent sources + community evidence" icon={Shield} accent="text-sky-300"/></div><h2 className="mb-3 text-sm font-semibold text-slate-200">Security-cleared takeovers</h2>{active.length ? <div className="mb-8 space-y-3">{active.map((token) => { const report = token.address ? reportMap.get(`${token.chain}:${token.address.toLowerCase()}`) : undefined; return <Card key={token.id}><CardContent className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-100">{token.name} <span className="text-slate-500">${token.symbol}</span></h3><Pill tone={statusTone(token.ctoStatus)}>{token.ctoStatus}</Pill><Pill tone={securityTone(report?.verdict)}>{report?.verdict ?? "UNKNOWN"}</Pill></div><p className="mt-2 text-xs text-slate-400">{token.ctoEvidence ?? "No evidence summary supplied."}</p></div><Link href={`/token/${token.chain}/${encodeURIComponent(token.address ?? "unknown")}`} className="text-xs text-emerald-300">View details <ArrowUpRight size={12} className="inline"/></Link></div><div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-3 text-xs sm:grid-cols-4"><span><b className="text-slate-600">Confidence</b><br/>{token.ctoConfidence == null ? "—" : `${token.ctoConfidence}%`}</span><span><b className="text-slate-600">Supporting accounts</b><br/>{token.ctoEvidenceAccountCount ?? "—"}</span><span><b className="text-slate-600">First detected</b><br/>{formatDate(token.ctoFirstDetectedAt)}</span><span><b className="text-slate-600">Last activity</b><br/>{formatDate(token.ctoLastActivityAt)}</span></div><div className="mt-3"><SourceLinks posts={token.sourcePosts}/></div>{report?.flags?.length ? <div className="mt-3 flex flex-wrap gap-1">{report.flags.map((flag) => <Pill key={flag} tone="yellow">{flag}</Pill>)}</div> : null}</CardContent></Card>; })}</div> : <div className="mb-8"><EmptyState icon={Globe2} title="No security-cleared CTOs" detail="A social claim or high post count alone is not enough to confirm a takeover. Candidates also need to pass token security."/></div>}<h2 className="mb-3 text-sm font-semibold text-slate-200">Unverified, disputed, rejected, or security-pending claims</h2>{claims.length ? <div className="space-y-3">{claims.map((item) => <Card key={item.token.id}><CardContent className="p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium text-slate-200">{item.token.name} <span className="text-slate-500">${item.token.symbol}</span></h3><Pill tone={statusTone(item.token.ctoStatus)}>{item.token.ctoStatus}</Pill><Pill tone={securityTone(item.verdict)}>{item.verdict}</Pill></div><p className="mt-2 text-xs text-slate-400">{item.reasons.join(" · ")}</p><div className="mt-3"><SourceLinks posts={item.token.sourcePosts}/></div></CardContent></Card>)}</div> : <p className="text-xs text-slate-500">No unresolved CTO claims are available.</p>}</>;
}
function NarrativeBoard({ narratives }: { narratives: Narrative[] }) {
  return <><PageHeading eyebrow="Social signal analysis" title="X Narratives" description="Metrics and trends are shown only when supplied by the worker. Source posts remain linked; potential spam is described as signals, not proof of manipulation."/>{narratives.length ? <div className="grid gap-4 xl:grid-cols-2">{narratives.map((item) => <Card key={item.id}><CardHeader><div><div className="flex items-center gap-2"><CardTitle>{item.category}</CardTitle>{item.accelerationScore != null && <Pill tone={item.accelerationScore >= 70 ? "green" : "blue"}>Acceleration {item.accelerationScore}</Pill>}</div><p className="mt-1 text-[11px] text-slate-500">Updated {timeAgo(item.lastUpdatedAt)}</p></div><div className="text-right"><div className="text-lg font-semibold text-slate-100">{item.mentionCount == null ? "—" : formatNumber(item.mentionCount)}</div><div className="text-[10px] text-slate-600">observed mentions</div></div></CardHeader><CardContent><div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-white/[0.05] bg-white/[0.015] p-3 text-xs sm:grid-cols-4"><div><span className="text-slate-600">Unique authors</span><p className="mt-1 text-slate-200">{formatNumber(item.uniqueAuthors)}</p></div><div><span className="text-slate-600">Engagement</span><p className="mt-1 text-slate-200">{formatNumber(item.engagement)}</p></div><div><span className="text-slate-600">Contract mentions</span><p className="mt-1 text-slate-200">{formatNumber(item.contractMentionCount)}</p></div><div><span className="text-slate-600">Security pass ratio</span><p className="mt-1 text-slate-200">{item.securityPassRatio == null ? "—" : `${item.securityPassRatio}%`}</p></div></div>{item.timeSeries && item.timeSeries.length > 1 ? <div className="mb-4 h-48 rounded-xl border border-white/[0.05] bg-[#080c11] p-2"><ResponsiveContainer width="100%" height="100%"><AreaChart data={item.timeSeries}><defs><linearGradient id={`fill-${item.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#55e7a4" stopOpacity={0.27}/><stop offset="100%" stopColor="#55e7a4" stopOpacity={0.01}/></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false}/><XAxis dataKey="at" tickFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}/><YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}/><Tooltip labelFormatter={(value) => formatDate(String(value))} contentStyle={{ background: "#111820", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, color: "#e2e8f0", fontSize: 12 }}/><Area type="monotone" dataKey="mentions" stroke="#55e7a4" fill={`url(#fill-${item.id})`} strokeWidth={2}/></AreaChart></ResponsiveContainer></div> : <div className="mb-4 rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-center text-xs text-slate-600">No time-series history supplied for this narrative.</div>}{item.spamSignals?.length ? <div className="mb-3 rounded-lg border border-amber-300/15 bg-amber-300/[0.035] p-3 text-xs text-amber-100/80"><div className="mb-1 flex items-center gap-1.5 font-medium text-amber-300"><AlertTriangle size={13}/>Potential promotion signals</div>{item.spamSignals.join(" · ")}<p className="mt-1 text-[10px] text-amber-100/50">Signals are not a finding of manipulation.</p></div> : <p className="mb-3 text-[10px] text-slate-600">No reliable spam/coordinated-activity analysis supplied.</p>}<SourceLinks posts={item.sourcePosts}/></CardContent></Card>)}</div> : <EmptyState icon={TrendingUp} title="No live narrative data" detail="Narrative discovery depends on a configured Agent-Reach worker. The dashboard does not invent X posts, authors, engagement, or time series."/>}</>;
}
function SecurityBoard({ queue, reports, exclusions }: { queue: DashboardPayload["securityQueue"]; reports: SecurityReport[]; exclusions: DashboardPayload["recentExclusions"] }) {
  return <><PageHeading eyebrow="Mandatory risk gate" title="Security Review" description="Pending, unknown, stale, or conflicting checks remain outside the primary token feed. A PASS is not a guarantee against future risk."/><div className="mb-5 grid gap-3 md:grid-cols-3"><MetricCard label="Review queue" value={queue.length} hint="Not approved for main feed" icon={ShieldAlert} accent="text-amber-300"/><MetricCard label="Cached assessments" value={reports.length} hint="Server-side provider results" icon={Shield} accent="text-emerald-300"/><MetricCard label="Recent exclusions" value={exclusions.length} hint="Failed policy or screening" icon={AlertTriangle} accent="text-rose-300"/></div><Card className="mb-5"><CardHeader><div><CardTitle>Pending / incomplete analysis</CardTitle><p className="mt-1 text-xs text-slate-500">No queue item is presented as safe.</p></div></CardHeader><CardContent>{queue.length ? <div className="space-y-3">{queue.map((item) => <div key={item.token.id} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4"><div className="flex flex-wrap items-center gap-2"><b className="text-sm text-slate-200">{item.token.name} · {item.token.symbol}</b><Pill tone="neutral">{chainLabel(item.token.chain)}</Pill><Pill tone={securityTone(item.verdict)}>{item.verdict}</Pill></div><p className="mt-2 break-all font-mono text-[11px] text-slate-500">{item.token.address ?? "Invalid or unavailable address"}</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-100/75">{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="mt-3"><SourceLinks posts={item.token.sourcePosts}/></div></div>)}</div> : <EmptyState icon={CheckCircle2} title="No pending reviews" detail="No candidate currently needs a security review."/>}</CardContent></Card><Card><CardHeader><div><CardTitle>Recent exclusions</CardTitle><p className="mt-1 text-xs text-slate-500">Excluded records are not part of the discoverable token feed.</p></div></CardHeader><CardContent>{exclusions.length ? <div className="space-y-2">{exclusions.map((item, index) => <div key={`${item.label}-${index}`} className="flex flex-wrap items-start justify-between gap-2 border-t border-white/[0.05] py-3 first:border-0"><div><b className="text-xs text-slate-300">{item.label}</b><p className="mt-1 text-xs text-rose-200/70">{item.reason}</p></div><span className="text-[10px] text-slate-600">{timeAgo(item.at)}</span></div>)}</div> : <p className="text-xs text-slate-600">No exclusions have been recorded.</p>}</CardContent></Card></>;
}
function WatchlistBoard({ data, saved, toggleSave }: { data: DashboardPayload; saved: string[]; toggleSave: (id: string) => void }) {
  const items = saved.map((key) => {
    const [kind, ...rest] = key.split(":"); const id = rest.join(":");
    if (kind === "token") { const token = data.tokens.find((row) => row.id === id); return token ? { key, title: `${token.name} · ${token.symbol}`, subtitle: `${chainLabel(token.chain)} · ${shortAddress(token.address)}`, link: token.address ? `/token/${token.chain}/${encodeURIComponent(token.address)}` : undefined } : { key, title: "Saved token", subtitle: "No longer in the approved feed", link: undefined }; }
    const item = (kind === "nft" ? data.nfts : data.gtd).find((row) => row.id === id);
    return item ? { key, title: item.name, subtitle: `${chainLabel(item.chain)} · ${item.mintAt ? formatDate(item.mintAt) : "Mint time not reported"}`, link: undefined } : { key, title: "Saved opportunity", subtitle: "No longer present in the latest data", link: undefined };
  });
  return <><PageHeading eyebrow="Personal tracking" title="Watchlist" description="Watchlist is stored locally in this browser only. It is not synchronized across devices and does not connect a wallet."/><div className="mb-4 flex items-center gap-2 text-xs text-slate-500"><Bookmark size={13}/>Saved items: {items.length} · local storage</div>{items.length ? <div className="space-y-2">{items.map((item) => <Card key={item.key}><CardContent className="flex items-center justify-between gap-3 p-4"><div>{item.link ? <Link href={item.link} className="text-sm font-medium text-slate-200 hover:text-emerald-200">{item.title}</Link> : <span className="text-sm font-medium text-slate-200">{item.title}</span>}<p className="mt-1 text-xs text-slate-500">{item.subtitle}</p></div><Button variant="ghost" size="sm" onClick={() => toggleSave(item.key)}>Remove <X size={13}/></Button></CardContent></Card>)}</div> : <EmptyState icon={Bookmark} title="Your watchlist is empty" detail="Save approved tokens or mint opportunities to keep them here on this device."/>}</>;
}
function SettingsBoard({ settings, onSave }: { settings: RadarClientSettings; onSave: (next: RadarClientSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const setNumber = (key: keyof Omit<RadarClientSettings, "filters">, value: string) => setDraft((current) => ({ ...current, [key]: Number(value) }));
  const filterLabels: [keyof RadarClientSettings["filters"], string][] = [["marketCap", "Minimum market capitalization"], ["holderConcentration", "Top-10 holder concentration"], ["developerHolding", "Developer holding (when reliably attributed)"], ["bundleBuy", "Bundle-buy indicator (when supported)"], ["sniperConcentration", "Sniper concentration (when supported)"], ["buyerPercentage", "Buyer percentage (documented method required)"]];
  return <><PageHeading eyebrow="Screening preferences" title="Settings" description="These settings customize screening only. Mandatory security checks, address validation, critical-risk exclusions, and server security TTL cannot be disabled here."/><Card className="mb-5"><CardHeader><div><CardTitle>Screening thresholds</CardTitle><p className="mt-1 text-xs text-slate-500">Saved in local storage and applied by the server when loading data.</p></div><SlidersHorizontal size={17} className="text-emerald-300"/></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><SettingNumber label="Minimum liquidity (USD) · mandatory" value={draft.minimumLiquidityUsd} onChange={(v) => setNumber("minimumLiquidityUsd", v)} step="1000"/><SettingNumber label="Minimum market cap (USD)" value={draft.minimumMarketCapUsd} onChange={(v) => setNumber("minimumMarketCapUsd", v)} step="5000"/><SettingNumber label="Minimum liquidity / market cap (%)" value={draft.minimumLiquidityToMarketCapPct} onChange={(v) => setNumber("minimumLiquidityToMarketCapPct", v)} step="1"/><SettingNumber label="Maximum top-10 concentration (%)" value={draft.maximumTop10HolderPct} onChange={(v) => setNumber("maximumTop10HolderPct", v)} step="1"/><SettingNumber label="Maximum developer holding (%)" value={draft.maximumDeveloperHoldingPct} onChange={(v) => setNumber("maximumDeveloperHoldingPct", v)} step="1"/><SettingNumber label="Maximum bundle-buy indicator (%)" value={draft.maximumBundleBuyPct} onChange={(v) => setNumber("maximumBundleBuyPct", v)} step="1"/><SettingNumber label="Maximum sniper concentration (%)" value={draft.maximumSniperConcentrationPct} onChange={(v) => setNumber("maximumSniperConcentrationPct", v)} step="1"/><SettingNumber label="Minimum buyer share (%)" value={draft.minimumBuyerPct} onChange={(v) => setNumber("minimumBuyerPct", v)} step="1"/><SettingNumber label="Low-cost mint threshold (USD)" value={draft.lowCostMintThresholdUsd} onChange={(v) => setNumber("lowCostMintThresholdUsd", v)} step="1"/></div><div className="mt-6 border-t border-white/[0.06] pt-5"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Optional non-critical filters</h3><div className="grid gap-2 md:grid-cols-2">{filterLabels.map(([key, label]) => <label key={key} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-3 text-xs text-slate-300"><span>{label}</span><input type="checkbox" checked={draft.filters[key]} onChange={(e) => setDraft((current) => ({ ...current, filters: { ...current.filters, [key]: e.target.checked } }))} className="size-4 accent-emerald-300"/></label>)}</div></div><div className="mt-5 flex flex-wrap gap-2"><Button variant="primary" onClick={() => onSave(draft)}><CheckCircle2 size={14}/>Save and apply</Button><Button variant="secondary" onClick={() => setDraft(defaultClientSettings)}>Restore defaults</Button></div><div className="mt-5 flex gap-2 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.035] p-3 text-[11px] leading-5 text-slate-400"><LockKeyhole size={13} className="mt-0.5 shrink-0 text-emerald-300"/>Mandatory: applicable security checks, valid chain/address, fresh provider result, no critical risk, minimum liquidity. No wallet connection, transaction signing, minting, or trading is implemented.</div></CardContent></Card><Card><CardHeader><CardTitle>Data policy</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-xs leading-5 text-slate-400"><li>• Missing, stale, or inconclusive checks remain outside the primary token feed.</li><li>• Screening thresholds are heuristics, not guarantees of safety.</li><li>• Watchlist and custom settings stay in this browser; no account sync is configured.</li><li>• Low-cost classification uses mint price only when the provider actually supplied a value.</li></ul></CardContent></Card></>;
}
function SettingNumber({ label, value, onChange, step }: { label: string; value: number; onChange: (value: string) => void; step: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs text-slate-400">{label}</span><Input type="number" min={label.startsWith("Minimum liquidity") ? 1 : 0} step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(e.target.value)}/></label>;
}
function OverviewBoard({ data, health }: { data: DashboardPayload; health: Health | null }) {
  const upcomingFree = data.nfts.filter((nft) => nft.status === "upcoming" && nft.kind === "free").length;
  const upcomingGtd = data.gtd.filter((gtd) => gtd.status === "officially-confirmed" && (!gtd.mintAt || Date.parse(gtd.mintAt) > Date.now())).length;
  const verifiedCto = data.tokens.filter((token) => token.ctoStatus === "verified").length;
  const emerging = data.narratives.filter((item) => (item.accelerationScore ?? 0) >= 60).length;
  const total = data.nfts.length + data.gtd.length + data.tokens.length + data.securityQueue.length;
  return <><PageHeading eyebrow="Market intelligence terminal" title="Overview" description="Early discovery, security screening, and source attribution across mints, tokens, and X narratives." action={<div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-xs text-slate-400"><Activity size={14} className="text-emerald-300"/>Last social sync <b className="text-slate-200">{timeAgo(data.lastSuccessfulSocialSyncAt)}</b></div>}/><WarningList warnings={data.warnings}/><div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Discovered records" value={total} hint="Mint, token, and security queue" icon={Radar}/><MetricCard label="Approved meme coins" value={data.tokens.length} hint="Passed mandatory gate" icon={CheckCircle2}/><MetricCard label="Pending security reviews" value={data.securityQueue.length} hint="Excluded from primary feed" icon={ShieldAlert} accent="text-amber-300"/><MetricCard label="Upcoming free mints" value={upcomingFree} hint="Price reported as zero" icon={Sparkles} accent="text-sky-300"/><MetricCard label="Upcoming GTD mints" value={upcomingGtd} hint="Official source verified" icon={Target} accent="text-violet-300"/><MetricCard label="Verified CTO tokens" value={verifiedCto} hint="Security-cleared only" icon={Globe2}/><MetricCard label="Emerging narratives" value={emerging} hint="Acceleration score ≥ 60" icon={TrendingUp} accent="text-sky-300"/><MetricCard label="Recent exclusions" value={data.recentExclusions.length} hint="Failed policy or screening" icon={AlertTriangle} accent="text-rose-300"/></div><div className="grid gap-4 xl:grid-cols-[1.4fr_.9fr]"><Card><CardHeader><div><CardTitle>Approved token distribution</CardTitle><p className="mt-1 text-xs text-slate-500">Current approved records by chain; no synthetic history.</p></div><Pill tone={data.mode === "live" ? "green" : "purple"}>{data.mode === "live" ? "Live mode" : "Demo mode"}</Pill></CardHeader><CardContent><StatChart tokens={data.tokens}/></CardContent></Card><Card><CardHeader><div><CardTitle>Data source health</CardTitle><p className="mt-1 text-xs text-slate-500">Provider status and latest successful sync</p></div><Button size="icon" variant="ghost" aria-label="Refresh health" onClick={() => window.dispatchEvent(new Event("radar-refresh-health"))}><RefreshCw size={14}/></Button></CardHeader><CardContent><SourceHealth health={health} payload={data}/><div className="mt-4 border-t border-white/[0.06] pt-3 text-[10px] text-slate-600">Dashboard generated {formatDate(data.generatedAt)}</div></CardContent></Card></div><div className="mt-4 grid gap-4 xl:grid-cols-2"><Card><CardHeader><div><CardTitle>Recent security exclusions</CardTitle><p className="mt-1 text-xs text-slate-500">Never shown in the approved meme coin feed.</p></div><ShieldAlert size={16} className="text-rose-300"/></CardHeader><CardContent>{data.recentExclusions.length ? data.recentExclusions.slice(0, 5).map((item, index) => <div key={`${item.label}-${index}`} className="border-t border-white/[0.05] py-3 first:border-0"><div className="flex justify-between gap-3"><b className="text-xs text-slate-300">{item.label}</b><span className="shrink-0 text-[10px] text-slate-600">{timeAgo(item.at)}</span></div><p className="mt-1 text-xs text-rose-200/70">{item.reason}</p></div>) : <p className="text-xs text-slate-600">No exclusions recorded.</p>}</CardContent></Card><Card><CardHeader><div><CardTitle>Freshness and coverage</CardTitle><p className="mt-1 text-xs text-slate-500">A quiet dataset is displayed as empty, not fabricated.</p></div><Clock3 size={16} className="text-sky-300"/></CardHeader><CardContent><SourceHealth health={health} payload={data}/></CardContent></Card></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-[11px] text-slate-500"><span className="flex items-center gap-2"><Zap size={13} className="text-emerald-300"/>Screening score is computed after mandatory security checks; missing metrics remain unavailable.</span><span>Data updated {timeAgo(data.generatedAt)}</span></div></>;
}

export function RadarDashboard() {
  const [active, setActive] = useState("Overview");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<RadarClientSettings>(defaultClientSettings);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const settingsRef = useRef(settings);
  const dataRef = useRef<DashboardPayload | null>(null);
  const pendingRef = useRef<{ controller: AbortController; key: string } | null>(null);
  const mountedRef = useRef(false);
  const [refreshNote, setRefreshNote] = useState("");

  async function loadDashboard(nextSettings: RadarClientSettings, isRefresh = false, acceptEmptySnapshot = false) {
    const key = JSON.stringify(nextSettings);
    if (pendingRef.current?.key === key && !acceptEmptySnapshot) return;
    pendingRef.current?.controller.abort();
    const controller = new AbortController();
    pendingRef.current = { controller, key };
    const timeout = window.setTimeout(() => controller.abort(), DASHBOARD_TIMEOUT_MS);
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError("");
    setRefreshNote("");
    try {
      const response = await fetch(`/api/dashboard?settings=${encodeURIComponent(key)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Dashboard request failed (${response.status}).`);
      const parsed = DashboardPayloadSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned data that does not match the dashboard schema.");
      if (controller.signal.aborted || !mountedRef.current || pendingRef.current?.controller !== controller) return;
      // Do not union approved tokens across snapshots: a newer security verdict may revoke approval.
      if (!acceptEmptySnapshot && dataRef.current?.mode === parsed.data.mode && hasDashboardRecords(dataRef.current) && !hasDashboardRecords(parsed.data)) {
        setRefreshNote("No records returned. Showing the previous snapshot; it may be out of date. Retrying automatically in 10 minutes.");
      } else {
        dataRef.current = parsed.data;
        setData(parsed.data);
        if (isRefresh) setRefreshNote("Refresh complete. Auto refresh every 10 minutes.");
      }
    } catch (cause) {
      if (!mountedRef.current || pendingRef.current?.controller !== controller) return;
      const message = controller.signal.aborted ? "Dashboard request timed out." : cause instanceof Error ? cause.message : "Dashboard data could not be loaded.";
      setError(`${message} ${dataRef.current ? "Showing the previous snapshot; it may be out of date. " : ""}Retrying automatically in 10 minutes.`);
    } finally {
      window.clearTimeout(timeout);
      if (pendingRef.current?.controller === controller) {
        pendingRef.current = null;
        if (mountedRef.current) { setLoading(false); setRefreshing(false); }
      }
    }
  }
  async function loadHealth() {
    try { const response = await fetch("/api/health", { cache: "no-store" }); if (response.ok) setHealth(await response.json()); } catch { setHealth(null); }
  }
  useEffect(() => {
    let current = defaultClientSettings;
    try { const saved = localStorage.getItem(settingsKey); if (saved) { const result = RadarClientSettingsSchema.safeParse(JSON.parse(saved)); if (result.success) current = result.data; } const savedWatch = JSON.parse(localStorage.getItem(watchKey) ?? "[]"); if (Array.isArray(savedWatch)) setWatchlist(savedWatch.filter((x) => typeof x === "string")); } catch { /* Ignore malformed local preferences. */ }
    mountedRef.current = true;
    settingsRef.current = current;
    setSettings(current);
    void loadDashboard(current);
    void loadHealth();
    const listener = () => { void loadHealth(); };
    window.addEventListener("radar-refresh-health", listener);
    const timer = window.setInterval(() => {
      void loadDashboard(settingsRef.current, true);
      void loadHealth();
    }, AUTO_REFRESH_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      pendingRef.current?.controller.abort();
      pendingRef.current = null;
      window.removeEventListener("radar-refresh-health", listener);
    };
  }, []);
  function toggleWatch(id: string) {
    setWatchlist((current) => { const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]; try { localStorage.setItem(watchKey, JSON.stringify(next)); } catch { /* Browser storage may be disabled. */ } return next; });
  }
  function saveSettings(next: RadarClientSettings) {
    const parsed = RadarClientSettingsSchema.safeParse(next);
    if (!parsed.success) { setError("Settings are outside supported ranges."); return; }
    settingsRef.current = parsed.data;
    setSettings(parsed.data);
    try { localStorage.setItem(settingsKey, JSON.stringify(parsed.data)); } catch { setError("Settings could not be saved in this browser."); }
    void loadDashboard(parsed.data, true);
  }
  function navigate(name: string) { setActive(name); setSidebarOpen(false); }

  return <div className="min-h-screen bg-[#080c11] text-slate-100">
    <aside className={`fixed inset-y-0 left-0 z-40 hidden w-[246px] border-r border-white/[0.06] bg-[#0a0f14] lg:block`}>
      <div className="flex h-[72px] items-center gap-3 border-b border-white/[0.06] px-5"><div className="flex size-9 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300"><Radar size={19}/></div><div><div className="text-sm font-semibold tracking-wide text-white">ONCHAIN <span className="text-emerald-300">RADAR</span></div><div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-slate-600">Intelligence terminal</div></div></div>
      <div className="px-3 pt-5"><div className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</div>{navItems.map(({ name, icon: Icon }, index) => <button key={name} onClick={() => navigate(name)} className={`nav-item ${active === name ? "nav-item-active" : ""}`}><Icon size={16}/><span>{name}</span>{name === "Security Review" && data?.securityQueue.length ? <span className="ml-auto rounded-full bg-amber-300/10 px-1.5 py-0.5 text-[9px] text-amber-300">{data.securityQueue.length}</span> : name === "Watchlist" && watchlist.length ? <span className="ml-auto text-[10px] text-slate-500">{watchlist.length}</span> : null}</button>)}</div>
      <div className="absolute bottom-4 left-3 right-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-300"><Shield size={14} className="text-emerald-300"/>Risk controls active</div><p className="text-[10px] leading-4 text-slate-600">No wallet connection, transaction signing, minting, or trading actions.</p></div>
    </aside>
    {sidebarOpen && <div className="fixed inset-0 z-50 bg-black/70 lg:hidden" onClick={() => setSidebarOpen(false)}><div className="h-full w-[280px] bg-[#0a0f14] p-4" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><span className="font-semibold">ONCHAIN <b className="text-emerald-300">RADAR</b></span><Button size="icon" variant="ghost" onClick={() => setSidebarOpen(false)}><X size={16}/></Button></div>{navItems.map(({ name, icon: Icon }) => <button key={name} onClick={() => navigate(name)} className={`nav-item ${active === name ? "nav-item-active" : ""}`}><Icon size={16}/>{name}</button>)}</div></div>}
    <div className="lg:ml-[246px]">
      <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-white/[0.06] bg-[#080c11]/90 px-4 backdrop-blur-xl md:px-7"><div className="flex items-center gap-3"><Button className="lg:hidden" size="icon" variant="ghost" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={18}/></Button><div className="lg:hidden flex items-center gap-2"><Radar size={17} className="text-emerald-300"/><b className="text-xs">ONCHAIN RADAR</b></div><div className="hidden items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-slate-500 md:flex"><Command size={12}/> Intelligence workspace <span className="text-slate-700">/</span><span className="text-slate-300">{active}</span></div></div><div className="flex items-center gap-2 md:gap-3"><div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"><span className={`size-1.5 rounded-full ${data?.mode === "live" ? "bg-emerald-300" : "bg-violet-300"}`}/><span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{data?.mode ?? "loading"}</span></div><span className="hidden text-[10px] text-slate-600 sm:inline">{data ? `Updated ${timeAgo(data.generatedAt)}` : "Connecting…"}</span><Button size="icon" variant="ghost" aria-label="Refresh dashboard" disabled={refreshing} onClick={() => { void loadDashboard(settings, true); void loadHealth(); }}><RefreshCw size={15} className={refreshing ? "animate-spin" : ""}/></Button></div></header>
      <main className="mx-auto max-w-[1500px] px-4 py-6 md:px-7 md:py-8">
        <div role="status" className="mb-4 text-xs text-slate-400">{refreshing ? "Refreshing…" : refreshNote || "Auto refresh every 10 minutes while this dashboard is open."}</div>
        {error && <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-sm text-rose-200"><AlertTriangle size={16}/>{error}<Button className="ml-auto" size="sm" variant="ghost" onClick={() => void loadDashboard(settings, true)}>Retry</Button></div>}
        {loading && !data ? <div className="space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-white/[0.05]"/><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-white/[0.04] bg-white/[0.02]"/>)}</div><div className="h-64 animate-pulse rounded-2xl border border-white/[0.04] bg-white/[0.02]"/></div> : !data ? <EmptyState icon={Activity} title="Dashboard unavailable" detail="No cached dataset could be loaded. Check your server configuration or retry."/> : <>
          {active === "Overview" && <OverviewBoard data={data} health={health}/>}
          {active === "Mint Scanner" && <><MintScannerBoard nfts={data.nfts} gtd={data.gtd} saved={watchlist} toggleSave={toggleWatch}/><SocialReviewSection items={data.socialReviewQueue} area="free-mint"/><SocialReviewSection items={data.socialReviewQueue} area="gtd-mint"/></>}
          {active === "Meme Coins" && <><MemeTable tokens={data.tokens} reports={data.securityReports} saved={watchlist} toggleSave={toggleWatch}/><SocialReviewSection items={data.socialReviewQueue} area="meme-coin"/></>}
          {active === "Web3 Games" && <Web3GamesBoard narratives={data.narratives.filter((item) => item.category === "Web3 Games")}/>}
          {active === "Free VPS" && <FreeVpsBoard narratives={data.narratives.filter((item) => item.category === "Free VPS")}/>}
          {active === "Community Takeover" && <><CtoBoard tokens={data.tokens} claims={data.ctoClaims} reports={data.securityReports}/><SocialReviewSection items={data.socialReviewQueue} area="cto"/></>}
          {active === "X Narratives" && <><NarrativeBoard narratives={data.narratives}/><SocialReviewSection items={data.socialReviewQueue} area="all"/></>}
          {active === "Security Review" && <SecurityBoard queue={data.securityQueue} reports={data.securityReports} exclusions={data.recentExclusions}/>}
          {active === "Watchlist" && <WatchlistBoard data={data} saved={watchlist} toggleSave={toggleWatch}/>}
          {active === "Settings" && <><SettingsBoard settings={settings} onSave={saveSettings}/><ScanHistoryDangerZone enabled={data.mode === "live"} onCleared={() => { void loadDashboard(settings, true, true); void loadHealth(); }}/></>}
        </>}
        <footer className="mt-10 border-t border-white/[0.05] pt-4 text-[10px] text-slate-700"><div className="flex flex-wrap items-center justify-between gap-2"><span>Onchain Radar · Data is informational, not financial advice.</span><span className="flex items-center gap-2"><Shield size={11}/>No wallet connection or transactions</span></div></footer>
      </main>
    </div>
  </div>;
}
