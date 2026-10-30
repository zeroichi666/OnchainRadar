-- Atomically clear scan-derived records and operational markers.
-- Only the server-side service role may execute this function.
create or replace function public.clear_scan_history()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidates_count bigint;
  nfts_count bigint;
  gtd_count bigint;
  narratives_count bigint;
  social_posts_count bigint;
  cto_evidence_count bigint;
  security_reports_count bigint;
  sync_state_count bigint;
  ingestion_events_count bigint;
begin
  delete from public.radar_candidates;
  get diagnostics candidates_count = row_count;
  delete from public.radar_nfts;
  get diagnostics nfts_count = row_count;
  delete from public.radar_gtd;
  get diagnostics gtd_count = row_count;
  delete from public.radar_narratives;
  get diagnostics narratives_count = row_count;
  delete from public.radar_social_posts;
  get diagnostics social_posts_count = row_count;
  delete from public.radar_cto_evidence;
  get diagnostics cto_evidence_count = row_count;
  delete from public.radar_security_reports;
  get diagnostics security_reports_count = row_count;
  delete from public.radar_sync_state;
  get diagnostics sync_state_count = row_count;
  delete from public.radar_ingestion_events;
  get diagnostics ingestion_events_count = row_count;

  return jsonb_build_object(
    'records', jsonb_build_object(
      'radar_candidates', candidates_count,
      'radar_nfts', nfts_count,
      'radar_gtd', gtd_count,
      'radar_narratives', narratives_count,
      'radar_social_posts', social_posts_count,
      'radar_cto_evidence', cto_evidence_count,
      'radar_security_reports', security_reports_count
    ),
    'syncState', sync_state_count,
    'ingestionEvents', ingestion_events_count
  );
end;
$$;

revoke all on function public.clear_scan_history() from public, anon, authenticated;
grant execute on function public.clear_scan_history() to service_role;
