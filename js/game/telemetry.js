// Server-sealed telemetry report foundation. Statistics and replay export are
// deliberately separate presentation slices; this loader gives every client
// the same immutable report envelope as soon as a match completes.
let currentSealedMatchReport = null;
let sealedReportLoadGameId = null;

async function loadSealedMatchReport(force = false) {
  if (!currentGameId || !currentGameState?.match_result) {
    currentSealedMatchReport = null;
    sealedReportLoadGameId = null;
    return null;
  }
  if (!force && sealedReportLoadGameId === currentGameId && currentSealedMatchReport) return currentSealedMatchReport;
  const { data, error } = await db.rpc('get_btech_match_report', { p_game_id: currentGameId });
  if (error) {
    console.warn('Unable to load the sealed match telemetry report:', error);
    return null;
  }
  currentSealedMatchReport = data || null;
  sealedReportLoadGameId = currentGameId;
  return currentSealedMatchReport;
}

function sealedTelemetryStatusText() {
  if (!currentGameState?.match_result) return '';
  if (!currentSealedMatchReport) return 'Final battle telemetry is being sealed…';
  const count = Number(currentSealedMatchReport.event_count || currentSealedMatchReport.report?.event_count || 0);
  return `Battle telemetry sealed · ${count} structured event${count === 1 ? '' : 's'} · ${currentSealedMatchReport.report_version}`;
}
