export type AlertLevel = 'NOMINAL' | 'YELLOW' | 'RED';

export type HazardScenarioId =
  | 'nominal'
  | 'solar_particle_event'
  | 'cephalad_fluid_shift'
  | 'long_duration_fatigue'
  | 'cascade_crisis';

export interface OsdrStudyRaw {
  filename: string;
  study_id: string;
  title: string;
  data_source: string;
  organism: string;
  mission: string;
  iss_medbay_module: string;
  assays: string[];
  protocols: Record<string, string | number>;
  physiological_parameters: Record<string, Record<string, number | string>>;
  diagnostic_explanation: string;
}

export interface MetricTelemetry {
  id: string;
  label: string;
  unit: string;
  studyId: string;
  value: number;
  displayValue: string;
  baseline: number;
  inFlightExtreme: number; // in_flight_peak or in_flight_drop
  yellowThreshold: number;
  redThreshold: number;
  direction: 'higher_worse' | 'lower_worse';
  status: AlertLevel;
  history: number[];
}

export interface CountermeasureSpec {
  id: string;
  terminalId: string;
  label: string;
  shortLabel: string;
  description: string;
  affectedStudies: string[];
  affectedTerminals: string[];
  active: boolean;
  effectivenessPct: number;
}

export interface CausalLink {
  id: string;
  fromTerminalId: string;
  toTerminalId: string;
  driverLabel: string;
  studyId: string;
  activeIntensity: number; // 0..1
}

export interface ActiveAlertDiagnostic {
  id: string;
  terminalId: string;
  terminalName: string;
  metricId: string;
  metricLabel: string;
  valueDisplay: string;
  thresholdDisplay: string;
  level: 'YELLOW' | 'RED';
  studyId: string;
  studyTitle: string;
  mission: string;
  organism: string;
  assays: string[];
  diagnosticExplanation: string;
  upstreamCause: string;
  recommendedCountermeasureId: string;
  recommendedCountermeasureLabel: string;
}

export interface TerminalSpec {
  id: string;
  index: number;
  name: string;
  shortName: string;
  bayLocation: string;
  roleSummary: string;
  position3D: [number, number, number];
  rotationY: number;
  cameraOffset: [number, number, number];
  studyIds: string[];
  countermeasure: CountermeasureSpec;
  metrics: MetricTelemetry[];
  status: AlertLevel;
  upstreamTerminalIds: string[];
  downstreamTerminalIds: string[];
}

export interface HazardDrivers {
  radiationExposure: number; // 0..1.5
  microgravityFluidShift: number; // 0..1.5
  mitochondrialStress: number; // 0..1.5
  isolationCircadianLoad: number; // 0..1.5
}

export type MissionLogCategory =
  | 'SCENARIO_REPORT'
  | 'THRESHOLD_BREACH'
  | 'COUNTERMEASURE'
  | 'RECOVERY';

export interface MissionLogEntry {
  id: string;
  timestamp: number;
  missionElapsedSec: number;
  scenario: HazardScenarioId;
  category: MissionLogCategory;
  severity: AlertLevel;
  title: string;
  summaryLine: string;
  reportText: string;
  citedStudies: string[];
  affectedTerminals: string[];
}

export interface TelemetrySnapshot {
  seq: number;
  timestamp: number;
  missionElapsedSec: number;
  scenario: HazardScenarioId;
  speedMultiplier: number;
  overallStatus: AlertLevel;
  yellowCount: number;
  redCount: number;
  hazards: HazardDrivers;
  terminals: TerminalSpec[];
  alerts: ActiveAlertDiagnostic[];
  causalLinks: CausalLink[];
  missionLogs: MissionLogEntry[];
  studies: Record<string, OsdrStudyRaw>;
}

export type ClientWsMessage =
  | { type: 'countermeasure:toggle'; terminalId: string; active: boolean }
  | { type: 'hazard:trigger'; scenario: HazardScenarioId }
  | { type: 'simulation:speed'; speed: number }
  | { type: 'simulation:reset' }
  | { type: 'report:generate' };

export type ServerWsMessage =
  | { type: 'telemetry:init'; snapshot: TelemetrySnapshot }
  | { type: 'telemetry:tick'; snapshot: TelemetrySnapshot };
