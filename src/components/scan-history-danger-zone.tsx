"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle, LockKeyhole, Trash2 } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui/primitives";
import { SCAN_HISTORY_CONFIRMATION } from "@/lib/scan-history";

type Props = { enabled: boolean; onCleared: () => void };

export function ScanHistoryDangerZone({ enabled, onCleared }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function cancel() {
    setConfirming(false);
    setConfirmation("");
    setSecret("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== SCAN_HISTORY_CONFIRMATION || !secret || busy) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch("/api/admin/scan-history", {
        method: "DELETE",
        cache: "no-store",
        mode: "same-origin",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const result = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Penghapusan gagal (${response.status}).`);
      setStatus("Semua riwayat scan pada penyimpanan aktif berhasil dihapus. Pengaturan dan watchlist browser tetap tersimpan.");
      setConfirming(false);
      setConfirmation("");
      setSecret("");
      onCleared();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Penghapusan gagal. Periksa koneksi dan konfigurasi server.");
    } finally {
      setBusy(false);
    }
  }

  return <Card className="mt-5 border-rose-400/20">
    <CardHeader>
      <div><CardTitle className="flex items-center gap-2 text-rose-200"><Trash2 size={15}/>Hapus riwayat scan</CardTitle><p className="mt-1 text-xs text-slate-500">Danger zone · berlaku pada provider penyimpanan aktif</p></div>
      <AlertTriangle size={17} className="text-rose-300"/>
    </CardHeader>
    <CardContent>
      <p className="text-xs leading-5 text-slate-400">Menghapus permanen kandidat, data mint, narasi, posting sumber, hasil pemeriksaan keamanan, serta penanda sinkronisasi dan ingest. Pengaturan layar dan watchlist yang tersimpan di browser tidak ikut dihapus.</p>
      {!enabled ? <p className="mt-3 text-xs text-slate-500">Fitur ini tersedia saat mode live aktif dan storage persisten telah dikonfigurasi.</p> : !confirming ? <Button className="mt-4" variant="danger" onClick={() => { setStatus(""); setError(""); setConfirming(true); }}>Hapus semua riwayat scan</Button> : <form className="mt-4 space-y-3" onSubmit={submit}>
        <div role="alert" className="flex gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs leading-5 text-rose-100/90"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-300"/><span>Tindakan ini tidak dapat dibatalkan. Masukkan frasa di bawah dan secret <code>SCAN_HISTORY_DELETE_SECRET</code> yang dikonfigurasi di server untuk melanjutkan.</span></div>
        <label className="block"><span className="mb-1.5 block text-xs text-slate-400">Ketik <code className="text-rose-200">{SCAN_HISTORY_CONFIRMATION}</code> untuk mengonfirmasi</span><Input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <label className="block"><span className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400"><LockKeyhole size={12}/>Secret admin server</span><Input type="password" name="scan-history-delete-secret" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="danger" disabled={busy || confirmation !== SCAN_HISTORY_CONFIRMATION || !secret}>{busy ? "Menghapus…" : "Konfirmasi dan hapus permanen"}</Button><Button type="button" variant="secondary" disabled={busy} onClick={cancel}>Batal</Button></div>
      </form>}
      {status && <p role="status" className="mt-3 text-xs leading-5 text-emerald-300">{status}</p>}
    </CardContent>
  </Card>;
}
