import React, { useMemo, useState } from 'react';
import {
  Activity,
  BedDouble,
  BrainCircuit,
  Dumbbell,
  Eye,
  FlaskConical,
  Gauge,
  Microscope,
  MoonStar,
  Pill,
  Radiation,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import type {
  AlertLevel,
  CausalLink,
  TerminalSpec,
} from '../types/medbay.ts';

export type BayZoneFilter = 'all' | 'forward' | 'mid' | 'aft';

interface IssMedicalBay2DMapProps {
  terminals: TerminalSpec[];
  causalLinks: CausalLink[];
  selectedTerminalId: string | null;
  zoneFilter: BayZoneFilter;
  onSelectTerminal: (terminalId: string) => void;
  onToggleCountermeasure: (terminalId: string, active: boolean) => void;
}

// 2D floorplan coordinates in a 1200 x 720 aerospace module canvas
// Arranged horizontally along the ISS longitudinal axis (Forward = Left, Aft = Right)
const TERMINAL_2D_COORDS: Record<string, { x: number; y: number; zone: BayZoneFilter }> = {
  // Forward Bay (Left)
  'radiation-console': { x: 175, y: 155, zone: 'forward' },
  'bio-scanner-bed': { x: 345, y: 360, zone: 'forward' },
  'rehab-terminal': { x: 175, y: 565, zone: 'forward' },

  // Mid-Bay (Center)
  'circadian-pod': { x: 485, y: 145, zone: 'mid' },
  'vascular-ultrasound': { x: 605, y: 310, zone: 'mid' },
  'sans-ocular-scanner': { x: 545, y: 575, zone: 'mid' },

  // Aft Bio-Lab (Right)
  'biomarker-analyzer': { x: 800, y: 145, zone: 'aft' },
  'lbnp-unit': { x: 760, y: 425, zone: 'aft' },
  'pharma-locker': { x: 840, y: 585, zone: 'aft' },
  'neural-sleep-modulator': { x: 1035, y: 215, zone: 'aft' },
  'peptide-bioreactor': { x: 1035, y: 505, zone: 'aft' },
};

function TerminalIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'bio-scanner-bed':
      return <BedDouble className={className} />;
    case 'radiation-console':
      return <Radiation className={className} />;
    case 'rehab-terminal':
      return <Dumbbell className={className} />;
    case 'circadian-pod':
      return <MoonStar className={className} />;
    case 'vascular-ultrasound':
      return <Activity className={className} />;
    case 'sans-ocular-scanner':
      return <Eye className={className} />;
    case 'biomarker-analyzer':
      return <Microscope className={className} />;
    case 'lbnp-unit':
      return <Gauge className={className} />;
    case 'pharma-locker':
      return <Pill className={className} />;
    case 'neural-sleep-modulator':
      return <BrainCircuit className={className} />;
    case 'peptide-bioreactor':
    default:
      return <FlaskConical className={className} />;
  }
}

function statusMeta(status: AlertLevel) {
  if (status === 'RED') {
    return {
      glyph: '✖ RED',
      textClass: 'text-rose-400',
      borderClass: 'border-rose-500/70',
      bgClass: 'bg-rose-950/35',
      glowColor: 'rgba(244, 63, 94, 0.25)',
    };
  }
  if (status === 'YELLOW') {
    return {
      glyph: '▲ YELLOW',
      textClass: 'text-amber-400',
      borderClass: 'border-amber-500/70',
      bgClass: 'bg-amber-950/25',
      glowColor: 'rgba(245, 158, 11, 0.2)',
    };
  }
  return {
    glyph: '● NOMINAL',
    textClass: 'text-emerald-400',
    borderClass: 'border-slate-700/90',
    bgClass: 'bg-[#0c1322]/95',
    glowColor: 'rgba(6, 182, 212, 0.12)',
  };
}

export const IssMedicalBay2DMap: React.FC<IssMedicalBay2DMapProps> = ({
  terminals,
  causalLinks,
  selectedTerminalId,
  zoneFilter,
  onSelectTerminal,
  onToggleCountermeasure,
}) => {
  const [hoveredTerminalId, setHoveredTerminalId] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<CausalLink | null>(null);
  const [showConduits, setShowConduits] = useState(true);
  const [zoom, setZoom] = useState(1);

  const activeFocusId = hoveredTerminalId ?? selectedTerminalId;

  const connectedToFocus = useMemo(() => {
    if (!activeFocusId) return new Set<string>();
    const set = new Set<string>([activeFocusId]);
    for (const link of causalLinks) {
      if (link.fromTerminalId === activeFocusId) set.add(link.toTerminalId);
      if (link.toTerminalId === activeFocusId) set.add(link.fromTerminalId);
    }
    return set;
  }, [activeFocusId, causalLinks]);

  const zoneOffset = useMemo(() => {
    if (zoneFilter === 'forward') return { x: 210, y: 0, scale: 1.22 };
    if (zoneFilter === 'mid') return { x: 0, y: 0, scale: 1.22 };
    if (zoneFilter === 'aft') return { x: -210, y: 0, scale: 1.22 };
    return { x: 0, y: 0, scale: 1 };
  }, [zoneFilter]);

  const effectiveScale = zoom * zoneOffset.scale;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#060911] flex items-center justify-center">
      {/* Subtle Blueprint Grid Background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-35"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(30,41,59,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(30,41,59,0.45) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top-Left 2D Schematic Legend & Conduit Toggle */}
      <div className="absolute top-3 left-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowConduits((v) => !v)}
          className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
            showConduits
              ? 'border-cyan-500/50 bg-cyan-950/40 text-cyan-200'
              : 'border-slate-800 bg-[#0b101b] text-slate-400 hover:text-white'
          }`}
        >
          {showConduits ? 'Causal Conduits: On' : 'Causal Conduits: Off'}
        </button>

        <div className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-md border border-slate-800 bg-[#0b101b]/95 text-[11px] font-mono-tabular text-slate-400">
          <span className="text-cyan-400">— Nominal Link</span>
          <span className="text-amber-400">— Secondary Risk</span>
          <span className="text-rose-400">— Critical Cascade</span>
          <span className="text-emerald-400">— Stabilizing Flow</span>
        </div>
      </div>

      {/* Top-Right Zoom Controls */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-1 rounded-md border border-slate-800 bg-[#0b101b]/95 p-1">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.15).toFixed(2))))}
          className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
          aria-label="Zoom out schematic"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 font-mono-tabular text-[11px] text-slate-300">
          {Math.round(effectiveScale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
          className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
          aria-label="Zoom in schematic"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
          aria-label="Reset schematic zoom"
          title="Fit schematic to viewport"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Hovered Causal Conduit Tooltip */}
      {hoveredLink && (
        <div className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-20 px-3.5 py-2 rounded-md border border-slate-700 bg-[#0b101b]/95 shadow-xl text-xs">
          <div className="flex items-center gap-2 font-mono-tabular">
            <span className="text-cyan-400 font-semibold">{hoveredLink.studyId}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-200 font-sans font-medium">
              {hoveredLink.driverLabel}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400">
              Coupling {Math.round(hoveredLink.activeIntensity * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Scalable 2D ISS Medical Bay Floorplan Container */}
      <div
        className="relative transition-transform duration-300 ease-out"
        style={{
          width: '1200px',
          height: '720px',
          transform: `translate(${zoneOffset.x}px, ${zoneOffset.y}px) scale(${effectiveScale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Architectural SVG Hull + Causal Conduits */}
        <svg
          viewBox="0 0 1200 720"
          className="absolute inset-0 w-full h-full"
          aria-label="ISS Medical Bay 2D Architectural Schematic"
        >
          <defs>
            <marker
              id="arrow-cyan"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4" />
            </marker>
            <marker
              id="arrow-amber"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
            </marker>
            <marker
              id="arrow-rose"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
            </marker>
            <marker
              id="arrow-emerald"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
            </marker>
          </defs>

          {/* Outer ISS Pressurized Module Hull */}
          <path
            d="M 70 90 L 130 42 L 1070 42 L 1130 90 L 1130 630 L 1070 678 L 130 678 L 70 630 Z"
            fill="#0a101d"
            stroke="#1e293b"
            strokeWidth="2.5"
          />

          {/* Inner Acoustic Bulkhead Liner */}
          <path
            d="M 88 104 L 140 60 L 1060 60 L 1112 104 L 1112 616 L 1060 660 L 140 660 L 88 616 Z"
            fill="#0d1525"
            stroke="#1e293b"
            strokeWidth="1"
          />

          {/* Forward & Aft Docking Hatches */}
          <rect x="44" y="295" width="32" height="130" rx="4" fill="#111827" stroke="#334155" strokeWidth="1.5" />
          <text
            x="60"
            y="360"
            textAnchor="middle"
            transform="rotate(-90 60 360)"
            fill="#64748b"
            fontSize="10"
            fontFamily="monospace"
          >
            FWD HATCH
          </text>

          <rect x="1124" y="295" width="32" height="130" rx="4" fill="#111827" stroke="#334155" strokeWidth="1.5" />
          <text
            x="1140"
            y="360"
            textAnchor="middle"
            transform="rotate(90 1140 360)"
            fill="#64748b"
            fontSize="10"
            fontFamily="monospace"
          >
            AFT HATCH
          </text>

          {/* Zone Dividers & Coordinate Labels */}
          <line x1="425" y1="62" x2="425" y2="658" stroke="#1e293b" strokeDasharray="6 6" strokeWidth="1" />
          <line x1="720" y1="62" x2="720" y2="658" stroke="#1e293b" strokeDasharray="6 6" strokeWidth="1" />

          <text x="248" y="82" textAnchor="middle" fill="#475569" fontSize="11" fontFamily="monospace">
            ZONE A · FORWARD SURGICAL &amp; RADIATION BAY
          </text>
          <text x="572" y="82" textAnchor="middle" fill="#475569" fontSize="11" fontFamily="monospace">
            ZONE B · MID-BAY OCULAR &amp; VASCULAR DIAGNOSTICS
          </text>
          <text x="920" y="82" textAnchor="middle" fill="#475569" fontSize="11" fontFamily="monospace">
            ZONE C · AFT BIO-LAB, LBNP &amp; SYNTHESIS
          </text>

          {/* Central Translation Corridor Spine */}
          <line
            x1="88"
            y1="360"
            x2="1112"
            y2="360"
            stroke="#0ea5e9"
            strokeOpacity="0.16"
            strokeDasharray="10 8"
            strokeWidth="2"
          />

          {/* Port & Starboard Crew Handrail Markers */}
          <line x1="150" y1="68" x2="1050" y2="68" stroke="#0284c7" strokeOpacity="0.4" strokeWidth="3" />
          <line x1="150" y1="652" x2="1050" y2="652" stroke="#0284c7" strokeOpacity="0.4" strokeWidth="3" />

          {/* Causal Conduits Layer */}
          {showConduits &&
            causalLinks.map((link) => {
              const p1 = TERMINAL_2D_COORDS[link.fromTerminalId];
              const p2 = TERMINAL_2D_COORDS[link.toTerminalId];
              if (!p1 || !p2) return null;

              const isRelated =
                !activeFocusId ||
                link.fromTerminalId === activeFocusId ||
                link.toTerminalId === activeFocusId;

              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const cx1 = p1.x + dx * 0.45;
              const cy1 = p1.y;
              const cx2 = p1.x + dx * 0.55;
              const cy2 = p2.y;
              const pathD = `M ${p1.x} ${p1.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p2.x} ${p2.y}`;

              const isPeptide = link.id === 'peptide-to-bio';
              const stroke = isPeptide
                ? '#10b981'
                : link.activeIntensity > 0.72
                  ? '#f43f5e'
                  : link.activeIntensity > 0.44
                    ? '#f59e0b'
                    : '#06b6d4';

              const markerEnd = isPeptide
                ? 'url(#arrow-emerald)'
                : link.activeIntensity > 0.72
                  ? 'url(#arrow-rose)'
                  : link.activeIntensity > 0.44
                    ? 'url(#arrow-amber)'
                    : 'url(#arrow-cyan)';

              const opacity = isRelated
                ? 0.35 + link.activeIntensity * 0.65
                : 0.1;

              return (
                <g
                  key={link.id}
                  onMouseEnter={() => setHoveredLink(link)}
                  onMouseLeave={() => setHoveredLink(null)}
                  className="cursor-help"
                >
                  {/* Invisible wider hit stroke for easy hovering */}
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth="14" />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={link.activeIntensity > 0.6 ? 2.6 : 1.75}
                    strokeOpacity={opacity}
                    strokeDasharray={link.activeIntensity > 0.45 ? '7 5' : undefined}
                    markerEnd={markerEnd}
                  />
                  {/* Study ID Pill-Free Inline Conduit Tag when highlighted */}
                  {activeFocusId && isRelated && Math.hypot(dx, dy) > 120 && (
                    <text
                      x={(p1.x + p2.x) / 2}
                      y={(p1.y + p2.y) / 2 - 6}
                      textAnchor="middle"
                      fill={stroke}
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="600"
                    >
                      {link.studyId}
                    </text>
                  )}
                </g>
              );
            })}
        </svg>

        {/* 11 Interactive 2D Medical Bay Station Nodes */}
        {terminals.map((term) => {
          const coord = TERMINAL_2D_COORDS[term.id];
          if (!coord) return null;

          const isSelected = selectedTerminalId === term.id;
          const isHovered = hoveredTerminalId === term.id;
          const isDimmed =
            Boolean(activeFocusId) && !connectedToFocus.has(term.id);
          const isZoneDimmed =
            zoneFilter !== 'all' && coord.zone !== zoneFilter;

          const meta = statusMeta(term.status);
          const primaryMetric = term.metrics[0];

          return (
            <div
              key={term.id}
              style={{
                left: `${coord.x}px`,
                top: `${coord.y}px`,
                boxShadow: isSelected
                  ? '0 0 0 2px rgba(34, 211, 238, 0.8), 0 12px 28px rgba(0,0,0,0.65)'
                  : `0 6px 20px ${meta.glowColor}`,
              }}
              onMouseEnter={() => setHoveredTerminalId(term.id)}
              onMouseLeave={() => setHoveredTerminalId(null)}
              onClick={() => onSelectTerminal(term.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTerminal(term.id);
                }
              }}
              aria-label={`Inspect ${term.name}, status ${term.status}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-[205px] rounded-lg border px-3 py-2.5 transition-all duration-150 cursor-pointer ${
                isSelected
                  ? 'border-cyan-400 bg-[#0e1a2e]'
                  : `${meta.borderClass} ${meta.bgClass} hover:border-cyan-400/70`
              } ${isDimmed || isZoneDimmed ? 'opacity-35' : 'opacity-100'} ${
                isHovered ? 'z-20 scale-[1.03]' : isSelected ? 'z-20' : 'z-10'
              }`}
            >
              {/* Top Row: Station Index + Status */}
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular">
                <span className="text-slate-400">
                  STN-{String(term.index).padStart(2, '0')}
                </span>
                <span className={`font-semibold ${meta.textClass}`}>
                  {meta.glyph}
                </span>
              </div>

              {/* Station Icon & Title */}
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className={`shrink-0 w-7 h-7 rounded flex items-center justify-center border ${
                    term.status === 'RED'
                      ? 'border-rose-500/40 bg-rose-950/50 text-rose-300'
                      : term.status === 'YELLOW'
                        ? 'border-amber-500/40 bg-amber-950/50 text-amber-300'
                        : 'border-slate-700 bg-slate-900 text-cyan-300'
                  }`}
                >
                  <TerminalIcon id={term.id} className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-xs font-semibold text-white truncate">
                    {term.shortName}
                  </div>
                  <div className="font-mono-tabular text-[10px] text-slate-400 truncate">
                    {term.studyIds.join(' · ')}
                  </div>
                </div>
              </div>

              {/* Primary Live Telemetry Value + Quick Countermeasure Toggle */}
              {primaryMetric && (
                <div className="mt-2 pt-2 border-t border-slate-800/90 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-400 truncate">
                      {primaryMetric.label}
                    </div>
                    <div className="font-mono-tabular text-sm font-semibold text-white">
                      {primaryMetric.displayValue}
                      <span className="ml-1 text-[10px] font-normal text-slate-400">
                        {primaryMetric.unit}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCountermeasure(
                        term.id,
                        !term.countermeasure.active,
                      );
                    }}
                    title={term.countermeasure.label}
                    className={`shrink-0 p-1.5 rounded border transition-colors cursor-pointer ${
                      term.countermeasure.active
                        ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                        : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/50'
                    }`}
                    aria-label={
                      term.countermeasure.active
                        ? `Disable ${term.countermeasure.shortLabel}`
                        : `Engage ${term.countermeasure.shortLabel}`
                    }
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
