import React from 'react';
import { ArrowUpRight, ShieldCheck, X } from 'lucide-react';
import type { ActiveAlertDiagnostic, TerminalSpec } from '../types/medbay.ts';

interface ActiveAlertsDrawerProps {
  alerts: ActiveAlertDiagnostic[];
  terminals: TerminalSpec[];
  onClose: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onToggleCountermeasure: (terminalId: string, active: boolean) => void;
}

export const ActiveAlertsDrawer: React.FC<ActiveAlertsDrawerProps> = ({
  alerts,
  terminals,
  onClose,
  onSelectTerminal,
  onToggleCountermeasure,
}) => {
  const terminalMap = new Map(terminals.map((t) => [t.id, t]));

  return (
    <section
      aria-label="Active NASA OSDR Diagnostic Alerts"
      className="fixed top-14 left-4 bottom-24 z-30 w-[min(440px,calc(100vw-2rem))] flex flex-col rounded-lg border border-slate-800 bg-[#0b101b]/96 text-slate-100 shadow-2xl"
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-800">
        <div>
          <div className="text-xs text-slate-400">
            Transparent Biological Diagnostics
          </div>
          <h2 className="mt-0.5 font-display text-lg font-semibold text-white">
            Active Bay Alerts ({alerts.length})
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-md border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
          aria-label="Close active alerts panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto medbay-scroll px-5 py-4 space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-[#111827] p-5 text-center">
            <div className="font-mono-tabular text-sm font-semibold text-emerald-400">
              ● ALL 11 TERMINALS NOMINAL
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              All monitored physiological parameters are currently within NASA OSDR baseline tolerances. Trigger an orbital hazard scenario in the top bar to inspect causal cascades.
            </p>
          </div>
        ) : (
          alerts.map((alert) => {
            const term = terminalMap.get(alert.terminalId);
            const cmActive = term?.countermeasure.active ?? false;
            return (
              <div
                key={alert.id}
                className={`rounded-lg border p-4 space-y-2.5 ${
                  alert.level === 'RED'
                    ? 'border-rose-500/45 bg-rose-950/20'
                    : 'border-amber-500/45 bg-amber-950/15'
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
                  <span className="font-mono-tabular text-xs text-cyan-400">
                    NASA {alert.studyId}
                  </span>
                </div>

                <div>
                  <div className="text-xs text-slate-400">
                    {alert.terminalName}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-white">
                    {alert.metricLabel}:{' '}
                    <span className="font-mono-tabular">{alert.valueDisplay}</span>{' '}
                    <span className="text-xs font-normal text-slate-400">
                      ({alert.thresholdDisplay})
                    </span>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-slate-200">
                  {alert.diagnosticExplanation}
                </p>

                <div className="text-[11px] text-slate-400">
                  Cascade: {alert.upstreamCause}
                </div>

                <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => onSelectTerminal(alert.terminalId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 text-xs text-slate-200 hover:text-white hover:border-slate-600 transition-colors cursor-pointer"
                  >
                    <span>Inspect Station</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleCountermeasure(alert.terminalId, !cmActive)
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                      cmActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {cmActive
                      ? `${alert.recommendedCountermeasureLabel} Active`
                      : `Engage ${alert.recommendedCountermeasureLabel}`}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
