import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useMedBaySocket } from './hooks/useMedBaySocket.ts';
import {
  IssMedicalBay2DMap,
  type BayZoneFilter,
} from './components/IssMedicalBay2DMap.tsx';
import { TerminalSlideOver } from './components/TerminalSlideOver.tsx';
import { ActiveAlertsDrawer } from './components/ActiveAlertsDrawer.tsx';
import { MissionLogsPanel } from './components/MissionLogsPanel.tsx';
import type { HazardScenarioId } from './types/medbay.ts';

function formatMissionClock(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `T+${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const SCENARIO_OPTIONS: { id: HazardScenarioId; label: string }[] = [
  { id: 'nominal', label: 'Nominal Orbit' },
  { id: 'solar_particle_event', label: 'Solar Particle Event (SPE)' },
  { id: 'cephalad_fluid_shift', label: 'Cephalad Fluid Shift (SANS)' },
  { id: 'long_duration_fatigue', label: 'Long-Duration (>120d) Unloading' },
  { id: 'cascade_crisis', label: 'Multi-Hazard Cascade' },
];

const ZONE_OPTIONS: { id: BayZoneFilter; label: string }[] = [
  { id: 'all', label: 'Full Bay' },
  { id: 'forward', label: 'Zone A · Forward' },
  { id: 'mid', label: 'Zone B · Mid-Bay' },
  { id: 'aft', label: 'Zone C · Aft Lab' },
];

export default function App() {
  const {
    snapshot,
    wsStatus,
    error,
    toggleCountermeasure,
    triggerScenario,
    setSpeed,
    resetSimulation,
    generateSitRep,
  } = useMedBaySocket();

  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(
    null,
  );
  const [alertsDrawerOpen, setAlertsDrawerOpen] = useState(false);
  const [missionLogsOpen, setMissionLogsOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [zoneFilter, setZoneFilter] = useState<BayZoneFilter>('all');

  const handleSelectTerminal = useCallback((terminalId: string) => {
    setSelectedTerminalId(terminalId);
  }, []);

  const handleSelectZone = useCallback((zone: BayZoneFilter) => {
    setZoneFilter(zone);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      } else if (e.key === 'Escape') {
        setSelectedTerminalId(null);
        setAlertsDrawerOpen(false);
        setMissionLogsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!snapshot) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#060911] text-slate-200">
        <div className="border border-slate-800 bg-[#0b101b] rounded-lg px-6 py-5 text-center max-w-sm">
          <div className="font-display text-lg font-semibold text-white">
            ISS Medical Bay
          </div>
          <div className="mt-2 font-mono-tabular text-xs text-cyan-400">
            Connecting WebSocket Telemetry Stream...
          </div>
          {error && <div className="mt-2 text-xs text-amber-400">{error}</div>}
        </div>
      </div>
    );
  }

  const selectedTerminal = selectedTerminalId
    ? snapshot.terminals.find((t) => t.id === selectedTerminalId) ?? null
    : null;

  const activeCmCount = snapshot.terminals.filter(
    (t) => t.countermeasure.active,
  ).length;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#060911] text-slate-100 select-none">
      {/* Top Telemetry Bar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-12 px-4 flex items-center justify-between gap-6 border-b border-slate-800 bg-[#070a12]/96">
        {/* Left Zone: Brand & Mission Clock */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            ISS Medical Bay
          </span>
          <span className="hidden lg:inline text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="hidden lg:inline font-mono-tabular text-xs text-slate-400 whitespace-nowrap shrink-0">
            {formatMissionClock(snapshot.missionElapsedSec)}
          </span>
          <span className="hidden xl:inline text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="hidden xl:inline font-mono-tabular text-xs text-slate-400 whitespace-nowrap shrink-0">
            10 NASA OSDR Studies
          </span>
        </div>

        {/* Center Zone: Live WebSocket State, Active Alert Trigger & Mission Logs */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setAlertsDrawerOpen((o) => !o);
              setMissionLogsOpen(false);
            }}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-mono-tabular font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              snapshot.redCount > 0
                ? 'border-rose-500/50 bg-rose-950/40 text-rose-300 hover:bg-rose-950/60'
                : snapshot.yellowCount > 0
                  ? 'border-amber-500/50 bg-amber-950/40 text-amber-300 hover:bg-amber-950/60'
                  : 'border-slate-800 bg-slate-900/90 text-emerald-400 hover:border-slate-700'
            }`}
          >
            {snapshot.alerts.length > 0 ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>
                  {snapshot.redCount > 0 ? `${snapshot.redCount} RED` : ''}
                  {snapshot.redCount > 0 && snapshot.yellowCount > 0 ? ' · ' : ''}
                  {snapshot.yellowCount > 0 ? `${snapshot.yellowCount} YELLOW` : ''}
                </span>
              </>
            ) : (
              <span>● ALL NOMINAL</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMissionLogsOpen((o) => !o);
              setAlertsDrawerOpen(false);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              missionLogsOpen
                ? 'border-cyan-500/60 bg-cyan-950/50 text-cyan-200'
                : 'border-slate-800 bg-slate-900/90 text-slate-200 hover:border-slate-700 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span>Mission Logs</span>
            <span className="font-mono-tabular text-[11px] text-slate-400">
              ({snapshot.missionLogs.length})
            </span>
          </button>

          <div className="hidden sm:flex items-center gap-1.5 font-mono-tabular text-[11px] text-slate-400 whitespace-nowrap">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                wsStatus === 'CONNECTED'
                  ? 'bg-emerald-400'
                  : 'bg-amber-400'
              }`}
            />
            <span>
              {wsStatus === 'CONNECTED' ? 'WS LIVE' : wsStatus}
            </span>
          </div>
        </div>

        {/* Right Zone: Hazard Scenario Injection & Reset */}
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="hazard-scenario" className="sr-only">
            Orbital Hazard Scenario
          </label>
          <select
            id="hazard-scenario"
            value={snapshot.scenario}
            onChange={(e) =>
              triggerScenario(e.target.value as HazardScenarioId)
            }
            className="h-8 px-2.5 rounded-md border border-slate-700 bg-[#0e1525] text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            {SCENARIO_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              resetSimulation();
              setAlertsDrawerOpen(false);
            }}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-md border border-slate-700 bg-[#0e1525] text-xs font-medium text-slate-200 hover:text-white hover:border-slate-600 transition-colors whitespace-nowrap cursor-pointer"
            title="Reset all hazards and countermeasures to baseline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Main 2D ISS Medical Bay Schematic Viewport */}
      <main className="h-full w-full pt-12">
        <IssMedicalBay2DMap
          terminals={snapshot.terminals}
          causalLinks={snapshot.causalLinks}
          selectedTerminalId={selectedTerminalId}
          zoneFilter={zoneFilter}
          onSelectTerminal={handleSelectTerminal}
          onToggleCountermeasure={toggleCountermeasure}
        />
      </main>

      {/* Active Alerts Left Drawer */}
      {alertsDrawerOpen && (
        <ActiveAlertsDrawer
          alerts={snapshot.alerts}
          terminals={snapshot.terminals}
          onClose={() => setAlertsDrawerOpen(false)}
          onSelectTerminal={(id) => {
            handleSelectTerminal(id);
          }}
          onToggleCountermeasure={toggleCountermeasure}
        />
      )}

      {/* Automated Flight Surgeon Mission Logs Left Drawer */}
      {missionLogsOpen && (
        <MissionLogsPanel
          logs={snapshot.missionLogs}
          terminals={snapshot.terminals}
          onClose={() => setMissionLogsOpen(false)}
          onGenerateSitRep={generateSitRep}
          onSelectTerminal={(id) => {
            handleSelectTerminal(id);
          }}
        />
      )}

      {/* Right Slide-Over Live Terminal Diagnostics Panel */}
      {selectedTerminal && (
        <TerminalSlideOver
          terminal={selectedTerminal}
          allTerminals={snapshot.terminals}
          studies={snapshot.studies}
          alerts={snapshot.alerts}
          onClose={() => setSelectedTerminalId(null)}
          onSelectTerminal={handleSelectTerminal}
          onToggleCountermeasure={toggleCountermeasure}
        />
      )}

      {/* Collapsible Bottom Control Dock */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-30 w-[min(1040px,95vw)] transition-transform duration-200 ${
          dockCollapsed ? 'bottom-0 translate-y-[calc(100%-30px)]' : 'bottom-3 translate-y-0'
        }`}
      >
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-t-md border border-b-0 border-slate-800 bg-[#0b101b]/95 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Show Bay Controls (H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Hide Controls (H)</span>
              </>
            )}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0b101b]/95 px-3 py-2.5 shadow-2xl space-y-2">
          {/* Row 1: Zone Focus + Speed + Active Countermeasures */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-1">Zone:</span>
              {ZONE_OPTIONS.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => handleSelectZone(z.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    zoneFilter === z.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
                  }`}
                >
                  {z.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 font-mono-tabular text-[11px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{activeCmCount}/11 Countermeasures Active</span>
              </div>

              <div className="flex items-center gap-1 border-l border-slate-800 pl-3">
                <span className="text-[11px] text-slate-400 mr-1">Rate:</span>
                {[1, 2, 5].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setSpeed(spd)}
                    className={`px-2 py-0.5 rounded font-mono-tabular text-[11px] transition-colors cursor-pointer ${
                      snapshot.speedMultiplier === spd
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {spd}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: 11 Medical Bay Terminals Selector Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto medbay-scroll pb-0.5">
            {snapshot.terminals.map((term) => {
              const isSelected = selectedTerminalId === term.id;
              return (
                <button
                  key={term.id}
                  type="button"
                  onClick={() => handleSelectTerminal(term.id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-950/50 text-white'
                      : 'border-slate-800 bg-[#0e1525] text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <span className="font-mono-tabular text-[10px] text-slate-500">
                    {String(term.index).padStart(2, '0')}
                  </span>
                  <span className="font-medium">{term.shortName}</span>
                  <span
                    className={`font-mono-tabular text-[10px] ${
                      term.status === 'RED'
                        ? 'text-rose-400'
                        : term.status === 'YELLOW'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                  }`}
                    title={`Status: ${term.status}`}
                  >
                    {term.status === 'RED'
                      ? '✖'
                      : term.status === 'YELLOW'
                        ? '▲'
                        : '●'}
                  </span>
                  {term.countermeasure.active && (
                    <ShieldCheck
                      className="w-3 h-3 text-emerald-400"
                      aria-label="Countermeasure active"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
