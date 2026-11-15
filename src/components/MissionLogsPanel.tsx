import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileText,
  PlusCircle,
  X,
} from 'lucide-react';
import type {
  MissionLogCategory,
  MissionLogEntry,
  TerminalSpec,
} from '../types/medbay.ts';

interface MissionLogsPanelProps {
  logs: MissionLogEntry[];
  terminals: TerminalSpec[];
  onClose: () => void;
  onGenerateSitRep: () => void;
  onSelectTerminal: (terminalId: string) => void;
}

type LogFilter = 'ALL' | MissionLogCategory;

function formatMissionClock(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `T+${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function categoryLabel(cat: MissionLogCategory): string {
  switch (cat) {
    case 'SCENARIO_REPORT':
      return 'Flight Surgeon Report';
    case 'THRESHOLD_BREACH':
      return 'Threshold Escalation';
    case 'COUNTERMEASURE':
      return 'Countermeasure Log';
    case 'RECOVERY':
      return 'Stabilization Confirmed';
  }
}

export const MissionLogsPanel: React.FC<MissionLogsPanelProps> = ({
  logs,
  terminals,
  onClose,
  onGenerateSitRep,
  onSelectTerminal,
}) => {
  const [filter, setFilter] = useState<LogFilter>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const terminalMap = useMemo(
    () => new Map(terminals.map((t) => [t.id, t])),
    [terminals],
  );

  const filteredLogs = useMemo(() => {
    if (filter === 'ALL') return logs;
    return logs.filter((entry) => entry.category === filter);
  }, [logs, filter]);

  const handleCopy = (entry: MissionLogEntry) => {
    const fullText = `[${formatMissionClock(entry.missionElapsedSec)}] ${entry.title}\nStudies: ${entry.citedStudies.join(', ') || 'Baseline'}\n\n${entry.reportText}`;
    navigator.clipboard?.writeText(fullText).then(() => {
      setCopiedId(entry.id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === entry.id ? null : cur));
      }, 1500);
    });
  };

  const handleExportTxt = () => {
    const content = logs
      .map((entry) => {
        return [
          '========================================================================',
          `${formatMissionClock(entry.missionElapsedSec)} | ${categoryLabel(entry.category).toUpperCase()} | SEVERITY: ${entry.severity}`,
          `TITLE: ${entry.title}`,
          `OSDR CITATIONS: ${entry.citedStudies.join(', ') || 'None'}`,
          '------------------------------------------------------------------------',
          entry.reportText,
          '',
        ].join('\n');
      })
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ISS-MedBay-Flight-Surgeon-Logs-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Automated Flight Surgeon Mission Logs"
      className="fixed top-14 left-4 bottom-24 z-30 w-[min(490px,calc(100vw-2rem))] flex flex-col rounded-lg border border-slate-800 bg-[#0b101b]/96 text-slate-100 shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span>Automated Flight Surgeon Log</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{logs.length} entries</span>
          </div>
          <h2 className="mt-1 font-display text-lg font-semibold text-white">
            Mission Logs
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onGenerateSitRep}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-cyan-500 text-slate-950 text-xs font-semibold hover:bg-cyan-400 transition-colors whitespace-nowrap cursor-pointer"
            title="Compile a live 11-station Flight Surgeon Situation Report"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Live SitRep</span>
          </button>

          <button
            type="button"
            onClick={handleExportTxt}
            className="p-2 rounded-md border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
            title="Export Flight Surgeon logs as .TXT"
            aria-label="Export logs as text file"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
            aria-label="Close mission logs panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="px-5 py-2.5 border-b border-slate-800/80 flex items-center gap-1.5 overflow-x-auto medbay-scroll">
        {(
          [
            { id: 'ALL', label: 'All Logs' },
            { id: 'SCENARIO_REPORT', label: 'Scenario Reports' },
            { id: 'THRESHOLD_BREACH', label: 'Escalations' },
            { id: 'COUNTERMEASURE', label: 'Countermeasures' },
            { id: 'RECOVERY', label: 'Recoveries' },
          ] as { id: LogFilter; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
              filter === tab.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-white border border-transparent hover:bg-slate-800/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Scrollable Report Feed */}
      <div className="flex-1 overflow-y-auto medbay-scroll px-5 py-4 space-y-3.5">
        {filteredLogs.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-[#0e1525] p-5 text-center text-xs text-slate-400">
            No mission log entries match this filter. Trigger a hazard scenario or engage a countermeasure to generate reports.
          </div>
        ) : (
          filteredLogs.map((entry) => {
            const severityText =
              entry.severity === 'RED'
                ? '✖ RED CRITICAL'
                : entry.severity === 'YELLOW'
                  ? '▲ YELLOW ALERT'
                  : '● NOMINAL';

            const severityColor =
              entry.severity === 'RED'
                ? 'text-rose-400'
                : entry.severity === 'YELLOW'
                  ? 'text-amber-400'
                  : 'text-emerald-400';

            const cardBorder =
              entry.severity === 'RED'
                ? 'border-rose-500/40 bg-rose-950/15'
                : entry.severity === 'YELLOW'
                  ? 'border-amber-500/35 bg-amber-950/10'
                  : 'border-slate-800 bg-[#0e1525]';

            return (
              <article
                key={entry.id}
                className={`rounded-lg border p-4 space-y-2.5 ${cardBorder}`}
              >
                {/* Metadata Header Line (Zero-Pill typographic separators) */}
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular">
                  <div className="flex items-center gap-2 min-w-0 text-slate-400">
                    <span className="text-slate-200 font-semibold">
                      {formatMissionClock(entry.missionElapsedSec)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{categoryLabel(entry.category)}</span>
                    <span aria-hidden="true">·</span>
                    <span className={`font-semibold shrink-0 ${severityColor}`}>
                      {severityText}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopy(entry)}
                    className="shrink-0 p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
                    title="Copy medical report to clipboard"
                    aria-label="Copy report"
                  >
                    {copiedId === entry.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <h3 className="font-display text-sm font-semibold text-white">
                  {entry.title}
                </h3>

                {/* Structured Flight Surgeon Narrative */}
                <div className="text-xs leading-relaxed text-slate-200 whitespace-pre-line font-sans">
                  {entry.reportText}
                </div>

                {/* Cited Studies */}
                {entry.citedStudies.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5 text-[11px] font-mono-tabular text-slate-400">
                    <span>OSDR Refs:</span>
                    {entry.citedStudies.map((sid, idx) => (
                      <React.Fragment key={sid}>
                        {idx > 0 && <span aria-hidden="true">·</span>}
                        <span className="text-cyan-400">{sid}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {/* Affected Stations Jump Strip */}
                {entry.affectedTerminals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {entry.affectedTerminals.map((tid) => {
                      const t = terminalMap.get(tid);
                      if (!t) return null;
                      return (
                        <button
                          key={tid}
                          type="button"
                          onClick={() => onSelectTerminal(tid)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700/80 bg-slate-900/90 text-[11px] text-slate-300 hover:text-white hover:border-cyan-500/60 transition-colors cursor-pointer"
                        >
                          <span>{t.shortName}</span>
                          <ArrowUpRight className="w-3 h-3 text-cyan-400" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};
