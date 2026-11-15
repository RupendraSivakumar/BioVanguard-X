import React, { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  X,
} from 'lucide-react';
import { SparklineChart } from './SparklineChart.tsx';
import type {
  ActiveAlertDiagnostic,
  AlertLevel,
  OsdrStudyRaw,
  TerminalSpec,
} from '../types/medbay.ts';

interface TerminalSlideOverProps {
  terminal: TerminalSpec;
  allTerminals: TerminalSpec[];
  studies: Record<string, OsdrStudyRaw>;
  alerts: ActiveAlertDiagnostic[];
  onClose: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onToggleCountermeasure: (terminalId: string, active: boolean) => void;
}

function statusBadge(status: AlertLevel) {
  if (status === 'RED') {
    return (
      <span className="font-mono-tabular text-xs font-semibold text-rose-400">
        ✖ RED CRITICAL
      </span>
    );
  }
  if (status === 'YELLOW') {
    return (
      <span className="font-mono-tabular text-xs font-semibold text-amber-400">
        ▲ YELLOW ALERT
      </span>
    );
  }
  return (
    <span className="font-mono-tabular text-xs font-semibold text-emerald-400">
      ● NOMINAL
    </span>
  );
}

function computeGaugePosition(
  value: number,
  baseline: number,
  redThreshold: number,
  direction: 'higher_worse' | 'lower_worse',
): number {
  if (direction === 'higher_worse') {
    const span = Math.max(0.001, redThreshold - baseline);
    const pct = ((value - baseline) / (span * 1.15)) * 100;
    return Math.max(2, Math.min(98, pct));
  } else {
    const span = Math.max(0.001, baseline - redThreshold);
    const pct = ((baseline - value) / (span * 1.15)) * 100;
    return Math.max(2, Math.min(98, pct));
  }
}

export const TerminalSlideOver: React.FC<TerminalSlideOverProps> = ({
  terminal,
  allTerminals,
  studies,
  alerts,
  onClose,
  onSelectTerminal,
  onToggleCountermeasure,
}) => {
  const [showStudyRefs, setShowStudyRefs] = useState(false);

  const terminalAlerts = alerts.filter((a) => a.terminalId === terminal.id);
  const terminalMap = new Map(allTerminals.map((t) => [t.id, t]));
  const activeStudyIds = Array.from(
    new Set([
      ...terminal.studyIds,
      ...terminal.metrics.map((m) => m.studyId),
    ]),
  );

  return (
    <aside
      aria-label={`${terminal.name} Live Diagnostics`}
      className="fixed top-14 right-4 bottom-24 z-30 w-[min(450px,calc(100vw-2rem))] flex flex-col rounded-lg border border-slate-800 bg-[#0b101b]/96 text-slate-100 shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono-tabular">
              Station {String(terminal.index).padStart(2, '0')}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{terminal.bayLocation}</span>
            <span aria-hidden="true">·</span>
            {statusBadge(terminal.status)}
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-white truncate">
            {terminal.name}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {terminal.roleSummary}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-2 rounded-md border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
          aria-label="Close diagnostics panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto medbay-scroll px-5 py-4 space-y-5">
        {/* Actionable Countermeasure Section */}
        <section className="rounded-lg border border-slate-800 bg-[#111827]/90 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-400">
                Actionable Countermeasure
              </div>
              <div className="mt-0.5 text-sm font-semibold text-white">
                {terminal.countermeasure.shortLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onToggleCountermeasure(
                  terminal.id,
                  !terminal.countermeasure.active,
                )
              }
              className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                terminal.countermeasure.active
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30'
                  : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              {terminal.countermeasure.active
                ? 'Active · Stabilizing'
                : 'Engage Countermeasure'}
            </button>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-slate-300">
            {terminal.countermeasure.description}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] font-mono-tabular text-slate-400">
            <span>Stabilizes:</span>
            {terminal.countermeasure.affectedStudies.map((sid, idx) => (
              <React.Fragment key={sid}>
                {idx > 0 && <span aria-hidden="true">·</span>}
                <span className="text-cyan-400">{sid}</span>
              </React.Fragment>
            ))}
          </div>
        </section>

        {/* Transparent "Why" Diagnostics (when Yellow or Red alerts exist) */}
        {terminalAlerts.length > 0 && (
          <section className="space-y-3">
            <div className="text-xs font-semibold tracking-wide text-slate-300">
              Active Threshold Diagnostics
            </div>
            {terminalAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg border p-4 ${
                  alert.level === 'RED'
                    ? 'border-rose-500/45 bg-rose-950/25'
                    : 'border-amber-500/45 bg-amber-950/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono-tabular text-xs font-semibold ${
                      alert.level === 'RED' ? 'text-rose-400' : 'text-amber-400'
                    }`}
                  >
                    {alert.level === 'RED' ? '✖ RED CRITICAL' : '▲ YELLOW ALERT'}
                  </span>
                  <span className="font-mono-tabular text-xs text-cyan-300">
                    NASA {alert.studyId}
                  </span>
                </div>
                <div className="mt-1.5 text-sm font-semibold text-white">
                  {alert.metricLabel}:{' '}
                  <span className="font-mono-tabular">{alert.valueDisplay}</span>{' '}
                  <span className="text-xs font-normal text-slate-400">
                    (Threshold {alert.thresholdDisplay})
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-200">
                  {alert.diagnosticExplanation}
                </p>
                <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                  <div>
                    <span className="text-slate-300 font-medium">Causal Driver:</span>{' '}
                    {alert.upstreamCause}
                  </div>
                  <div>
                    <span className="text-slate-300 font-medium">Source Study:</span>{' '}
                    {alert.studyTitle} ({alert.mission})
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Live Telemetry Metrics */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-slate-300">
              Live OSDR Telemetry Channels
            </span>
            <span className="font-mono-tabular text-[11px] text-slate-500">
              {terminal.metrics.length} parameters
            </span>
          </div>

          {terminal.metrics.map((m) => {
            const pct = computeGaugePosition(
              m.value,
              m.baseline,
              m.redThreshold,
              m.direction,
            );
            const yellowPct = computeGaugePosition(
              m.yellowThreshold,
              m.baseline,
              m.redThreshold,
              m.direction,
            );
            const redPct = computeGaugePosition(
              m.redThreshold,
              m.baseline,
              m.redThreshold,
              m.direction,
            );

            return (
              <div
                key={m.id}
                className="rounded-lg border border-slate-800/90 bg-[#0e1525] p-3.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-300 truncate">
                      {m.label}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-mono-tabular text-slate-500">
                      <span>{m.studyId}</span>
                      <span aria-hidden="true">·</span>
                      <span>Base {m.baseline}</span>
                      <span aria-hidden="true">·</span>
                      <span>Peak {m.inFlightExtreme}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={`font-mono-tabular text-xl font-semibold ${
                        m.status === 'RED'
                          ? 'text-rose-400'
                          : m.status === 'YELLOW'
                            ? 'text-amber-400'
                            : 'text-white'
                      }`}
                    >
                      {m.displayValue}
                    </span>
                    <span className="ml-1 font-mono-tabular text-[11px] text-slate-400">
                      {m.unit}
                    </span>
                  </div>
                </div>

                {/* Threshold Gauge Bar */}
                <div className="mt-2.5 relative h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      m.status === 'RED'
                        ? 'bg-rose-500'
                        : m.status === 'YELLOW'
                          ? 'bg-amber-500'
                          : 'bg-cyan-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-300/80"
                    style={{ left: `${yellowPct}%` }}
                    title={`Yellow threshold: ${m.yellowThreshold}`}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-rose-400/90"
                    style={{ left: `${redPct}%` }}
                    title={`Red threshold: ${m.redThreshold}`}
                  />
                </div>

                <div className="mt-2">
                  <SparklineChart
                    history={m.history}
                    yellowThreshold={m.yellowThreshold}
                    redThreshold={m.redThreshold}
                    baseline={m.baseline}
                    status={m.status}
                  />
                </div>

                <div className="mt-1 flex items-center justify-between text-[11px] font-mono-tabular text-slate-500">
                  <span>Yellow: {m.yellowThreshold} {m.unit}</span>
                  <span>Red: {m.redThreshold} {m.unit}</span>
                </div>
              </div>
            );
          })}
        </section>

        {/* Interconnected Systems Graph */}
        {(terminal.upstreamTerminalIds.length > 0 ||
          terminal.downstreamTerminalIds.length > 0) && (
          <section className="rounded-lg border border-slate-800 bg-[#0e1525] p-4 space-y-3">
            <div className="text-xs font-semibold tracking-wide text-slate-300">
              Interconnected Bay Systems
            </div>

            {terminal.upstreamTerminalIds.length > 0 && (
              <div>
                <div className="text-[11px] text-slate-400 mb-1.5">
                  Upstream Hazard Inputs
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {terminal.upstreamTerminalIds.map((uid) => {
                    const t = terminalMap.get(uid);
                    if (!t) return null;
                    return (
                      <button
                        key={uid}
                        type="button"
                        onClick={() => onSelectTerminal(uid)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 text-xs text-slate-200 hover:border-cyan-500/60 hover:text-white transition-colors cursor-pointer"
                      >
                        <span
                          className={
                            t.status === 'RED'
                              ? 'text-rose-400'
                              : t.status === 'YELLOW'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                          }
                        >
                          {t.status === 'RED' ? '✖' : t.status === 'YELLOW' ? '▲' : '●'}
                        </span>
                        <span>{t.shortName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {terminal.downstreamTerminalIds.length > 0 && (
              <div>
                <div className="text-[11px] text-slate-400 mb-1.5">
                  Downstream Connected Terminals
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {terminal.downstreamTerminalIds.map((did) => {
                    const t = terminalMap.get(did);
                    if (!t) return null;
                    return (
                      <button
                        key={did}
                        type="button"
                        onClick={() => onSelectTerminal(did)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 text-xs text-slate-200 hover:border-cyan-500/60 hover:text-white transition-colors cursor-pointer"
                      >
                        <ArrowRight className="w-3 h-3 text-cyan-400" />
                        <span>{t.shortName}</span>
                        <span
                          className={
                            t.status === 'RED'
                              ? 'text-rose-400'
                              : t.status === 'YELLOW'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                          }
                        >
                          {t.status === 'RED' ? '✖' : t.status === 'YELLOW' ? '▲' : '●'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Linked NASA OSDR Study Metadata */}
        <section className="rounded-lg border border-slate-800 bg-[#0e1525]">
          <button
            type="button"
            onClick={() => setShowStudyRefs((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
              Linked NASA OSDR Studies ({activeStudyIds.join(', ')})
            </span>
            {showStudyRefs ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showStudyRefs && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-800 pt-3">
              {activeStudyIds.map((sid) => {
                const s = studies[sid];
                if (!s) return null;
                return (
                  <div
                    key={sid}
                    className="text-xs border border-slate-800/80 rounded p-3 bg-slate-950/60 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular font-semibold text-cyan-400">
                        {s.study_id}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {s.organism}
                      </span>
                    </div>
                    <div className="font-medium text-slate-200">{s.title}</div>
                    <div className="text-[11px] text-slate-400">
                      Mission: {s.mission}
                    </div>
                    <div className="text-[11px] text-slate-300 leading-relaxed">
                      {s.diagnostic_explanation}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Assays: {s.assays.join(' · ')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
