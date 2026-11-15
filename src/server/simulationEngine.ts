import { loadOsdrStudies } from './osdrLoader.ts';
import type {
  ActiveAlertDiagnostic,
  AlertLevel,
  CausalLink,
  HazardDrivers,
  HazardScenarioId,
  MetricTelemetry,
  MissionLogCategory,
  MissionLogEntry,
  OsdrStudyRaw,
  TelemetrySnapshot,
  TerminalSpec,
} from '../types/medbay.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getParamNumber(
  study: OsdrStudyRaw,
  paramKey: string,
  field: string,
  fallback: number,
): number {
  const param = study.physiological_parameters[paramKey];
  if (!param) return fallback;
  const val = param[field];
  return typeof val === 'number' ? val : fallback;
}

function evaluateStatus(
  value: number,
  yellow: number,
  red: number,
  direction: 'higher_worse' | 'lower_worse',
): AlertLevel {
  if (direction === 'higher_worse') {
    if (value >= red) return 'RED';
    if (value >= yellow) return 'YELLOW';
    return 'NOMINAL';
  } else {
    if (value <= red) return 'RED';
    if (value <= yellow) return 'YELLOW';
    return 'NOMINAL';
  }
}

function worstStatus(statuses: AlertLevel[]): AlertLevel {
  if (statuses.includes('RED')) return 'RED';
  if (statuses.includes('YELLOW')) return 'YELLOW';
  return 'NOMINAL';
}

interface InternalMetricConfig {
  id: string;
  label: string;
  unit: string;
  studyId: string;
  paramKey: string;
  baseline: number;
  inFlightExtreme: number;
  yellowThreshold: number;
  redThreshold: number;
  direction: 'higher_worse' | 'lower_worse';
  decimals: number;
  formatFn?: (val: number) => string;
  computeTarget: (
    hazards: HazardDrivers,
    cm: Record<string, boolean>,
    t: number,
  ) => number;
}

interface InternalTerminalConfig {
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
  upstreamTerminalIds: string[];
  downstreamTerminalIds: string[];
  countermeasure: {
    id: string;
    label: string;
    shortLabel: string;
    description: string;
    affectedStudies: string[];
    affectedTerminals: string[];
  };
  metrics: InternalMetricConfig[];
}

export class MedBaySimulationEngine {
  studies: Record<string, OsdrStudyRaw>;
  seq: number;
  missionElapsedSec: number;
  scenario: HazardScenarioId;
  speedMultiplier: number;
  hazards: HazardDrivers;
  countermeasures: Record<string, boolean>;
  terminalConfigs: InternalTerminalConfig[];
  metricValues: Record<string, number>;
  metricHistory: Record<string, number[]>;
  scenarioStartTime: number;
  missionLogs: MissionLogEntry[];
  logCounter: number;
  prevTerminalStatuses: Record<string, AlertLevel>;
  prevOverallStatus: AlertLevel;

  constructor() {
    this.studies = loadOsdrStudies();
    this.seq = 0;
    this.missionElapsedSec = 4120 * 60 + 18; // T+68:40:18 orbital mission clock
    this.scenario = 'nominal';
    this.speedMultiplier = 1;
    this.scenarioStartTime = 0;
    this.missionLogs = [];
    this.logCounter = 0;
    this.prevTerminalStatuses = {};
    this.prevOverallStatus = 'NOMINAL';
    this.hazards = {
      radiationExposure: 0.22,
      microgravityFluidShift: 0.26,
      mitochondrialStress: 0.20,
      isolationCircadianLoad: 0.18,
    };

    this.countermeasures = {
      'bio-scanner-bed': false,
      'radiation-console': false,
      'rehab-terminal': false,
      'circadian-pod': false,
      'vascular-ultrasound': false,
      'sans-ocular-scanner': false,
      'biomarker-analyzer': false,
      'lbnp-unit': false,
      'pharma-locker': false,
      'neural-sleep-modulator': false,
      'peptide-bioreactor': false,
    };

    this.terminalConfigs = this.buildTerminalConfigs();
    this.metricValues = {};
    this.metricHistory = {};

    for (const term of this.terminalConfigs) {
      this.prevTerminalStatuses[term.id] = 'NOMINAL';
      for (const m of term.metrics) {
        this.metricValues[m.id] = m.baseline;
        this.metricHistory[m.id] = Array.from({ length: 24 }, () => m.baseline);
      }
    }

    this.appendMissionLog({
      category: 'SCENARIO_REPORT',
      severity: 'NOMINAL',
      title: 'Flight Surgeon Shift Handover — Nominal Orbital Baseline',
      summaryLine: 'All 11 medical stations calibrated against 10 NASA OSDR baselines.',
      reportText:
        'MEDICAL OFFICER LOG — ORBITAL HANDOVER:\n' +
        'Crew bio-telemetry across all 11 ISS Medical Bay stations is within nominal pre-flight baseline bands. ' +
        'Reference physiological thresholds are actively calibrated from 10 NASA OSDR spaceflight and analog datasets (OSD-530, OSD-569, OSD-575, OSD-656, OSD-816, OSD-817, OSD-897, OSD-941, OSD-984, OSD-1018).\n' +
        'RECOMMENDATION: Maintain routine ARED resistive exercise compliance and continuous dosimetry watch.',
      citedStudies: ['OSD-530', 'OSD-575', 'OSD-656', 'OSD-816', 'OSD-984'],
      affectedTerminals: ['bio-scanner-bed', 'radiation-console', 'lbnp-unit'],
    });
  }

  private buildTerminalConfigs(): InternalTerminalConfig[] {
    const s575 = this.studies['OSD-575'];
    const s656 = this.studies['OSD-656'];
    const s569 = this.studies['OSD-569'];
    const s816 = this.studies['OSD-816'];
    const s817 = this.studies['OSD-817'];
    const s530 = this.studies['OSD-530'];
    const s941 = this.studies['OSD-941'];
    const s984 = this.studies['OSD-984'];
    const s1018 = this.studies['OSD-1018'];
    const s897 = this.studies['OSD-897'];

    return [
      {
        id: 'bio-scanner-bed',
        index: 1,
        name: 'Bio-Scanner Bed',
        shortName: 'Bio-Scanner',
        bayLocation: 'Center-Forward Surgical Spine',
        roleSummary:
          'Full-body cellular, plasma cfRNA liquid biopsy, and systemic inflammatory cytokine scanner.',
        position3D: [0, 0, -2.5],
        rotationY: 0,
        cameraOffset: [2.8, 2.1, 2.8],
        studyIds: ['OSD-530', 'OSD-575'],
        upstreamTerminalIds: ['lbnp-unit', 'radiation-console', 'peptide-bioreactor'],
        downstreamTerminalIds: ['neural-sleep-modulator', 'vascular-ultrasound'],
        countermeasure: {
          id: 'cryo-metabolic-stabilizer',
          label: 'Activate Cryo-Metabolic & Anti-Cytokine Stabilization',
          shortLabel: 'Metabolic Stabilizer',
          description:
            'Infuses targeted metabolic buffer and cools systemic inflammation markers (IL-6, glucose, oxidative cfRNA).',
          affectedStudies: ['OSD-530', 'OSD-575'],
          affectedTerminals: ['bio-scanner-bed', 'vascular-ultrasound'],
        },
        metrics: [
          {
            id: 'circulating_exmt_cfrna_fold',
            label: 'Circulating exMT cfRNA',
            unit: 'fold',
            studyId: 'OSD-530',
            paramKey: 'circulating_exmt_cfrna_fold',
            baseline: getParamNumber(s530, 'circulating_exmt_cfrna_fold', 'baseline', 1.0),
            inFlightExtreme: getParamNumber(s530, 'circulating_exmt_cfrna_fold', 'in_flight_peak', 2.8),
            yellowThreshold: getParamNumber(s530, 'circulating_exmt_cfrna_fold', 'yellow_threshold', 2.0),
            redThreshold: getParamNumber(s530, 'circulating_exmt_cfrna_fold', 'red_threshold', 3.0),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const base = 1.0;
              const peak = 2.8;
              const drive = h.mitochondrialStress * 0.85 + h.radiationExposure * 0.35;
              const mitigation =
                (cm['peptide-bioreactor'] ? 0.55 : 0) +
                (cm['bio-scanner-bed'] ? 0.35 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(base, peak, eff) + Math.sin(t * 0.4) * 0.04;
            },
          },
          {
            id: 'oxidative_stress_transcript_score',
            label: 'Oxidative Stress Transcript',
            unit: 'score',
            studyId: 'OSD-530',
            paramKey: 'oxidative_stress_transcript_score',
            baseline: getParamNumber(s530, 'oxidative_stress_transcript_score', 'baseline', 15),
            inFlightExtreme: getParamNumber(s530, 'oxidative_stress_transcript_score', 'in_flight_peak', 48),
            yellowThreshold: getParamNumber(s530, 'oxidative_stress_transcript_score', 'yellow_threshold', 35),
            redThreshold: getParamNumber(s530, 'oxidative_stress_transcript_score', 'red_threshold', 55),
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const drive = h.mitochondrialStress * 0.78 + h.radiationExposure * 0.42;
              const mitigation =
                (cm['peptide-bioreactor'] ? 0.50 : 0) +
                (cm['biomarker-analyzer'] ? 0.25 : 0) +
                (cm['bio-scanner-bed'] ? 0.25 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(15, 48, eff) + Math.cos(t * 0.35) * 0.6;
            },
          },
          {
            id: 'cellular_homeostasis_index',
            label: 'Cellular Homeostasis Index',
            unit: '%',
            studyId: 'OSD-530',
            paramKey: 'cellular_homeostasis_index',
            baseline: getParamNumber(s530, 'cellular_homeostasis_index', 'baseline', 96),
            inFlightExtreme: getParamNumber(s530, 'cellular_homeostasis_index', 'in_flight_drop', 74),
            yellowThreshold: getParamNumber(s530, 'cellular_homeostasis_index', 'yellow_threshold', 80),
            redThreshold: getParamNumber(s530, 'cellular_homeostasis_index', 'red_threshold', 70),
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const drive = h.mitochondrialStress * 0.8 + h.radiationExposure * 0.3;
              const mitigation =
                (cm['peptide-bioreactor'] ? 0.55 : 0) +
                (cm['bio-scanner-bed'] ? 0.35 : 0);
              const eff = clamp(drive - mitigation, 0, 1.3);
              return lerp(96, 74, eff) + Math.sin(t * 0.3) * 0.4;
            },
          },
          {
            id: 'il6_inflammatory_cytokine_fold',
            label: 'IL-6 Inflammatory Cytokine',
            unit: 'fold',
            studyId: 'OSD-575',
            paramKey: 'il6_inflammatory_cytokine_fold',
            baseline: getParamNumber(s575, 'il6_inflammatory_cytokine_fold', 'baseline', 1.0),
            inFlightExtreme: getParamNumber(s575, 'il6_inflammatory_cytokine_fold', 'in_flight_peak', 2.3),
            yellowThreshold: getParamNumber(s575, 'il6_inflammatory_cytokine_fold', 'yellow_threshold', 1.8),
            redThreshold: getParamNumber(s575, 'il6_inflammatory_cytokine_fold', 'red_threshold', 2.5),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const drive =
                h.microgravityFluidShift * 0.6 +
                h.mitochondrialStress * 0.4 +
                h.radiationExposure * 0.25;
              const mitigation =
                (cm['bio-scanner-bed'] ? 0.45 : 0) +
                (cm['peptide-bioreactor'] ? 0.35 : 0) +
                (cm['lbnp-unit'] ? 0.2 : 0);
              const eff = clamp(drive - mitigation, 0, 1.3);
              return lerp(1.0, 2.3, eff) + Math.sin(t * 0.5) * 0.03;
            },
          },
          {
            id: 'glucose_mg_dL',
            label: 'Serum Glucose (CMP)',
            unit: 'mg/dL',
            studyId: 'OSD-575',
            paramKey: 'glucose_mg_dL',
            baseline: getParamNumber(s575, 'glucose_mg_dL', 'baseline', 88),
            inFlightExtreme: getParamNumber(s575, 'glucose_mg_dL', 'in_flight_peak', 114),
            yellowThreshold: getParamNumber(s575, 'glucose_mg_dL', 'yellow_threshold', 105),
            redThreshold: getParamNumber(s575, 'glucose_mg_dL', 'red_threshold', 126),
            direction: 'higher_worse',
            decimals: 0,
            computeTarget: (h, cm, t) => {
              const drive = h.mitochondrialStress * 0.65 + h.isolationCircadianLoad * 0.45;
              const mitigation =
                (cm['rehab-terminal'] ? 0.45 : 0) +
                (cm['bio-scanner-bed'] ? 0.4 : 0);
              const eff = clamp(drive - mitigation, 0, 1.4);
              return lerp(88, 114, eff) + Math.cos(t * 0.25) * 0.8;
            },
          },
        ],
      },
      {
        id: 'radiation-console',
        index: 2,
        name: 'Radiation & Life Support Console',
        shortName: 'Radiation Console',
        bayLocation: 'Port Forward Bulkhead Rack',
        roleSummary:
          'Monitors cumulative GCR (HZE heavy ion) & Solar Particle Event proton flux with storm shelter shielding.',
        position3D: [-3.9, 0, -4.0],
        rotationY: Math.PI / 2.6,
        cameraOffset: [2.3, 1.8, 2.3],
        studyIds: ['OSD-984', 'OSD-897'],
        upstreamTerminalIds: [],
        downstreamTerminalIds: [
          'rehab-terminal',
          'biomarker-analyzer',
          'circadian-pod',
          'neural-sleep-modulator',
          'pharma-locker',
        ],
        countermeasure: {
          id: 'radiation-shielding',
          label: 'Deploy Water-Wall Storm Shelter & Polyethylene Shielding',
          shortLabel: 'Storm Shielding',
          description:
            'Pumps potable/gray water bladders into bulkhead panels and activates active magnetic/polyethylene shielding, attenuating GCR/SPE dose rate by 72%.',
          affectedStudies: ['OSD-984', 'OSD-897', 'OSD-1018'],
          affectedTerminals: [
            'radiation-console',
            'rehab-terminal',
            'neural-sleep-modulator',
            'circadian-pod',
            'pharma-locker',
          ],
        },
        metrics: [
          {
            id: 'cumulative_gcr_dose_mSv',
            label: 'Cumulative GCR / SPE Dose',
            unit: 'mSv',
            studyId: 'OSD-984',
            paramKey: 'cumulative_gcr_dose_mSv',
            baseline: getParamNumber(s984, 'cumulative_gcr_dose_mSv', 'baseline', 0),
            inFlightExtreme: getParamNumber(s984, 'cumulative_gcr_dose_mSv', 'mission_alert', 250),
            yellowThreshold: getParamNumber(s984, 'cumulative_gcr_dose_mSv', 'yellow_threshold', 150),
            redThreshold: getParamNumber(s984, 'cumulative_gcr_dose_mSv', 'red_threshold', 300),
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const mitigation = cm['radiation-console'] ? 0.68 : 0;
              const eff = clamp(h.radiationExposure * (1 - mitigation), 0, 1.35);
              return lerp(28, 250, eff) + Math.sin(t * 0.6) * 1.2;
            },
          },
          {
            id: 'cabin_radiation_flux_uSv_hr',
            label: 'Live Cabin Ionizing Flux',
            unit: 'µSv/hr',
            studyId: 'OSD-897',
            paramKey: 'pvt_reaction_time_ms',
            baseline: 18,
            inFlightExtreme: 92,
            yellowThreshold: 50,
            redThreshold: 80,
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const mitigation = cm['radiation-console'] ? 0.72 : 0;
              const eff = clamp(h.radiationExposure * (1 - mitigation), 0, 1.35);
              return lerp(18, 92, eff) + Math.sin(t * 1.4) * 1.6;
            },
          },
        ],
      },
      {
        id: 'rehab-terminal',
        index: 3,
        name: 'Countermeasure Rehab Terminal',
        shortName: 'Rehab Terminal',
        bayLocation: 'Starboard Forward Bay',
        roleSummary:
          'ARED resistive exercise & musculoskeletal telemetry monitoring unloading + GCR protein loss.',
        position3D: [3.7, 0, -3.9],
        rotationY: -Math.PI / 2.6,
        cameraOffset: [-2.4, 1.8, 2.4],
        studyIds: ['OSD-984'],
        upstreamTerminalIds: ['radiation-console', 'peptide-bioreactor'],
        downstreamTerminalIds: ['bio-scanner-bed'],
        countermeasure: {
          id: 'ared-exercise',
          label: 'Initiate ARED Resistive Loading & T2 Protocol',
          shortLabel: 'ARED Protocol',
          description:
            'Executes high-load axial skeletal compression and eccentric muscle resistance to counteract unloading atrophy and stimulate mitochondrial protein synthesis.',
          affectedStudies: ['OSD-984', 'OSD-575'],
          affectedTerminals: ['rehab-terminal', 'bio-scanner-bed'],
        },
        metrics: [
          {
            id: 'skeletal_muscle_mass_loss_pct',
            label: 'Skeletal Muscle Mass Delta',
            unit: '%',
            studyId: 'OSD-984',
            paramKey: 'skeletal_muscle_mass_loss_pct',
            baseline: getParamNumber(s984, 'skeletal_muscle_mass_loss_pct', 'baseline', 0),
            inFlightExtreme: getParamNumber(s984, 'skeletal_muscle_mass_loss_pct', 'in_flight_drop', -8.5),
            yellowThreshold: getParamNumber(s984, 'skeletal_muscle_mass_loss_pct', 'yellow_threshold', -5.0),
            redThreshold: getParamNumber(s984, 'skeletal_muscle_mass_loss_pct', 'red_threshold', -10.0),
            direction: 'lower_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = h.mitochondrialStress * 0.65 + radFactor * 0.55;
              const mitigation =
                (cm['rehab-terminal'] ? 0.65 : 0) +
                (cm['peptide-bioreactor'] ? 0.25 : 0);
              const eff = clamp(drive - mitigation, 0, 1.3);
              return lerp(0.0, -8.5, eff) + Math.sin(t * 0.3) * 0.08;
            },
          },
          {
            id: 'bone_mineral_density_loss_pct_per_mo',
            label: 'Bone Mineral Density Rate',
            unit: '%/mo',
            studyId: 'OSD-984',
            paramKey: 'bone_mineral_density_loss_pct_per_mo',
            baseline: getParamNumber(s984, 'bone_mineral_density_loss_pct_per_mo', 'baseline', 0),
            inFlightExtreme: getParamNumber(s984, 'bone_mineral_density_loss_pct_per_mo', 'in_flight_drop', -1.4),
            yellowThreshold: getParamNumber(s984, 'bone_mineral_density_loss_pct_per_mo', 'yellow_threshold', -1.0),
            redThreshold: getParamNumber(s984, 'bone_mineral_density_loss_pct_per_mo', 'red_threshold', -1.8),
            direction: 'lower_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = h.mitochondrialStress * 0.6 + radFactor * 0.5;
              const mitigation = cm['rehab-terminal'] ? 0.72 : 0;
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(0.0, -1.4, eff) + Math.cos(t * 0.25) * 0.02;
            },
          },
        ],
      },
      {
        id: 'circadian-pod',
        index: 4,
        name: 'Behavioral & Circadian Pod',
        shortName: 'Circadian Pod',
        bayLocation: 'Port Mid-Bay Alcove',
        roleSummary:
          'EEG sleep architecture, isolation cortisol tracking, and sensorimotor balance telemetry.',
        position3D: [-4.1, 0, -1.2],
        rotationY: Math.PI / 2,
        cameraOffset: [2.5, 1.7, 1.4],
        studyIds: ['OSD-1018', 'OSD-941'],
        upstreamTerminalIds: ['radiation-console'],
        downstreamTerminalIds: ['neural-sleep-modulator', 'bio-scanner-bed'],
        countermeasure: {
          id: 'circadian-phototherapy',
          label: 'Engage 480nm Circadian Phototherapy & Ground Link',
          shortLabel: 'Circadian Light',
          description:
            'Synchronizes melatonin-cortisol rhythm with calibrated 480nm solid-state lighting and live crew ground behavioral support.',
          affectedStudies: ['OSD-1018'],
          affectedTerminals: ['circadian-pod', 'neural-sleep-modulator'],
        },
        metrics: [
          {
            id: 'rem_sleep_efficiency_pct',
            label: 'REM Sleep Efficiency',
            unit: '%',
            studyId: 'OSD-1018',
            paramKey: 'rem_sleep_efficiency_pct',
            baseline: getParamNumber(s1018, 'rem_sleep_efficiency_pct', 'baseline', 100),
            inFlightExtreme: getParamNumber(s1018, 'rem_sleep_efficiency_pct', 'in_flight_drop', 76),
            yellowThreshold: getParamNumber(s1018, 'rem_sleep_efficiency_pct', 'yellow_threshold', 82),
            redThreshold: getParamNumber(s1018, 'rem_sleep_efficiency_pct', 'red_threshold', 70),
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = h.isolationCircadianLoad * 0.72 + radFactor * 0.42;
              const mitigation =
                (cm['circadian-pod'] ? 0.58 : 0) +
                (cm['neural-sleep-modulator'] ? 0.32 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(100, 76, eff) + Math.sin(t * 0.4) * 0.5;
            },
          },
          {
            id: 'isolation_stress_cortisol_ng_mL',
            label: 'Salivary Cortisol (Stress)',
            unit: 'ng/mL',
            studyId: 'OSD-1018',
            paramKey: 'isolation_stress_cortisol_ng_mL',
            baseline: getParamNumber(s1018, 'isolation_stress_cortisol_ng_mL', 'baseline', 14.0),
            inFlightExtreme: getParamNumber(s1018, 'isolation_stress_cortisol_ng_mL', 'in_flight_peak', 26.5),
            yellowThreshold: getParamNumber(s1018, 'isolation_stress_cortisol_ng_mL', 'yellow_threshold', 22.0),
            redThreshold: getParamNumber(s1018, 'isolation_stress_cortisol_ng_mL', 'red_threshold', 30.0),
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = h.isolationCircadianLoad * 0.75 + radFactor * 0.35;
              const mitigation =
                (cm['circadian-pod'] ? 0.62 : 0) +
                (cm['neural-sleep-modulator'] ? 0.2 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(14.0, 26.5, eff) + Math.cos(t * 0.3) * 0.3;
            },
          },
          {
            id: 'sensorimotor_balance_score',
            label: 'Sensorimotor Balance Score',
            unit: 'pts',
            studyId: 'OSD-1018',
            paramKey: 'sensorimotor_balance_score',
            baseline: getParamNumber(s1018, 'sensorimotor_balance_score', 'baseline', 95),
            inFlightExtreme: getParamNumber(s1018, 'sensorimotor_balance_score', 'in_flight_drop', 78),
            yellowThreshold: getParamNumber(s1018, 'sensorimotor_balance_score', 'yellow_threshold', 80),
            redThreshold: getParamNumber(s1018, 'sensorimotor_balance_score', 'red_threshold', 70),
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = h.isolationCircadianLoad * 0.55 + radFactor * 0.55;
              const mitigation =
                (cm['circadian-pod'] ? 0.45 : 0) +
                (cm['rehab-terminal'] ? 0.35 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(95, 78, eff) + Math.sin(t * 0.45) * 0.4;
            },
          },
        ],
      },
      {
        id: 'vascular-ultrasound',
        index: 5,
        name: 'Vascular Ultrasound Station',
        shortName: 'Vascular Echo',
        bayLocation: 'Center-Port Diagnostic Island',
        roleSummary:
          'Internal jugular Doppler flow & cardiovascular serum troponin/electrolyte array.',
        position3D: [-2.1, 0, -0.3],
        rotationY: Math.PI / 4,
        cameraOffset: [2.2, 1.7, 2.2],
        studyIds: ['OSD-575'],
        upstreamTerminalIds: ['lbnp-unit', 'bio-scanner-bed'],
        downstreamTerminalIds: ['sans-ocular-scanner'],
        countermeasure: {
          id: 'vascular-compression',
          label: 'Activate Venous Compression Cuffs & Doppler Sync',
          shortLabel: 'Venous Cuffs',
          description:
            'Applies graduated lower-extremity and thigh occlusion cuffs to reduce internal jugular venous stasis and myocardial wall strain.',
          affectedStudies: ['OSD-575'],
          affectedTerminals: ['vascular-ultrasound', 'sans-ocular-scanner'],
        },
        metrics: [
          {
            id: 'cardiac_troponin_biomarker_fold',
            label: 'Cardiac Troponin Biomarker',
            unit: 'fold',
            studyId: 'OSD-575',
            paramKey: 'cardiac_troponin_biomarker_fold',
            baseline: getParamNumber(s575, 'cardiac_troponin_biomarker_fold', 'baseline', 1.0),
            inFlightExtreme: getParamNumber(s575, 'cardiac_troponin_biomarker_fold', 'in_flight_peak', 1.45),
            yellowThreshold: getParamNumber(s575, 'cardiac_troponin_biomarker_fold', 'yellow_threshold', 1.3),
            redThreshold: getParamNumber(s575, 'cardiac_troponin_biomarker_fold', 'red_threshold', 1.8),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.45 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.65 + h.mitochondrialStress * 0.45;
              const mitigation =
                (cm['vascular-ultrasound'] ? 0.55 : 0) +
                (cm['bio-scanner-bed'] ? 0.25 : 0);
              const eff = clamp(drive - mitigation, 0, 1.45);
              return lerp(1.0, 1.45, eff) + Math.sin(t * 0.7) * 0.02;
            },
          },
          {
            id: 'potassium_mmol_L',
            label: 'Serum Potassium (K+)',
            unit: 'mmol/L',
            studyId: 'OSD-575',
            paramKey: 'potassium_mmol_L',
            baseline: getParamNumber(s575, 'potassium_mmol_L', 'baseline', 4.2),
            inFlightExtreme: getParamNumber(s575, 'potassium_mmol_L', 'in_flight_peak', 4.9),
            yellowThreshold: getParamNumber(s575, 'potassium_mmol_L', 'yellow_threshold', 5.0),
            redThreshold: getParamNumber(s575, 'potassium_mmol_L', 'red_threshold', 5.5),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.4 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.6 + h.mitochondrialStress * 0.4;
              const mitigation =
                (cm['vascular-ultrasound'] ? 0.35 : 0) +
                (cm['lbnp-unit'] ? 0.35 : 0);
              const eff = clamp(drive - mitigation, 0, 1.5);
              return lerp(4.2, 4.9, eff) + Math.cos(t * 0.4) * 0.03;
            },
          },
        ],
      },
      {
        id: 'sans-ocular-scanner',
        index: 6,
        name: 'SANS Ocular Scanner',
        shortName: 'SANS Ocular',
        bayLocation: 'Starboard Mid-Bay Imaging Rig',
        roleSummary:
          'Optical Coherence Tomography (OCT), ERG, and translaminar ICP:IOP optic nerve diagnostics.',
        position3D: [4.0, 0, -1.1],
        rotationY: -Math.PI / 2,
        cameraOffset: [-2.4, 1.7, 1.4],
        studyIds: ['OSD-816', 'OSD-817'],
        upstreamTerminalIds: ['lbnp-unit', 'vascular-ultrasound'],
        downstreamTerminalIds: [],
        countermeasure: {
          id: 'sans-goggles',
          label: 'Engage SANS Translaminar Pressure Goggles',
          shortLabel: 'SANS Goggles',
          description:
            'Applies regulated periocular negative pressure to balance the translaminar ICP:IOP gradient, preventing optic disc edema and hyperopic shift.',
          affectedStudies: ['OSD-816', 'OSD-817'],
          affectedTerminals: ['sans-ocular-scanner'],
        },
        metrics: [
          {
            id: 'icp_mmHg',
            label: 'Intracranial Pressure (ICP vs 16 IOP)',
            unit: 'mmHg',
            studyId: 'OSD-816',
            paramKey: 'icp_iop_pressure_ratio_mmHg',
            baseline: 12.0,
            inFlightExtreme: 15.5,
            yellowThreshold: getParamNumber(s816, 'icp_iop_pressure_ratio_mmHg', 'yellow_threshold_icp', 14),
            redThreshold: getParamNumber(s816, 'icp_iop_pressure_ratio_mmHg', 'red_threshold_icp', 16),
            direction: 'higher_worse',
            decimals: 1,
            formatFn: (v) => `${v.toFixed(1)}:16`,
            computeTarget: (h, cm, t) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.35 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.95;
              const mitigation =
                (cm['sans-ocular-scanner'] ? 0.55 : 0) +
                (cm['vascular-ultrasound'] ? 0.25 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(12.0, 15.5, eff) + Math.sin(t * 0.4) * 0.08;
            },
          },
          {
            id: 'retinal_nerve_fiber_thickness_um',
            label: 'Retinal Nerve Fiber Thickness',
            unit: 'µm',
            studyId: 'OSD-816',
            paramKey: 'retinal_nerve_fiber_thickness_um',
            baseline: getParamNumber(s816, 'retinal_nerve_fiber_thickness_um', 'baseline', 98),
            inFlightExtreme: getParamNumber(s816, 'retinal_nerve_fiber_thickness_um', 'in_flight_peak', 124),
            yellowThreshold: getParamNumber(s816, 'retinal_nerve_fiber_thickness_um', 'yellow_threshold', 115),
            redThreshold: getParamNumber(s816, 'retinal_nerve_fiber_thickness_um', 'red_threshold', 130),
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.35 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.9;
              const mitigation =
                (cm['sans-ocular-scanner'] ? 0.6 : 0) +
                (cm['vascular-ultrasound'] ? 0.2 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(98, 124, eff) + Math.cos(t * 0.35) * 0.4;
            },
          },
          {
            id: 'erg_b_wave_amplitude_pct',
            label: 'ERG b-Wave Amplitude',
            unit: '%',
            studyId: 'OSD-816',
            paramKey: 'erg_b_wave_amplitude_pct',
            baseline: getParamNumber(s816, 'erg_b_wave_amplitude_pct', 'baseline', 100),
            inFlightExtreme: getParamNumber(s816, 'erg_b_wave_amplitude_pct', 'in_flight_drop', 81),
            yellowThreshold: getParamNumber(s816, 'erg_b_wave_amplitude_pct', 'yellow_threshold', 85),
            redThreshold: getParamNumber(s816, 'erg_b_wave_amplitude_pct', 'red_threshold', 75),
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.35 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.85 + h.radiationExposure * 0.15;
              const mitigation = cm['sans-ocular-scanner'] ? 0.65 : 0;
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(100, 81, eff) + Math.sin(t * 0.5) * 0.3;
            },
          },
          {
            id: 'optic_disc_edema_frisen_grade',
            label: 'Optic Disc Edema (Frisén)',
            unit: 'grade',
            studyId: 'OSD-817',
            paramKey: 'optic_disc_edema_frisen_grade',
            baseline: getParamNumber(s817, 'optic_disc_edema_frisen_grade', 'baseline', 0),
            inFlightExtreme: getParamNumber(s817, 'optic_disc_edema_frisen_grade', 'in_flight_peak', 2),
            yellowThreshold: getParamNumber(s817, 'optic_disc_edema_frisen_grade', 'yellow_threshold', 1),
            redThreshold: getParamNumber(s817, 'optic_disc_edema_frisen_grade', 'red_threshold', 3),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.35 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.9;
              const mitigation = cm['sans-ocular-scanner'] ? 0.62 : 0;
              const eff = clamp(drive - mitigation, 0, 1.5);
              return lerp(0, 2.0, eff);
            },
          },
          {
            id: 'axon_stress_index_pct',
            label: 'Optic Axon Stress Index',
            unit: '%',
            studyId: 'OSD-817',
            paramKey: 'axon_stress_index_pct',
            baseline: getParamNumber(s817, 'axon_stress_index_pct', 'baseline', 2.0),
            inFlightExtreme: getParamNumber(s817, 'axon_stress_index_pct', 'in_flight_peak', 14.5),
            yellowThreshold: getParamNumber(s817, 'axon_stress_index_pct', 'yellow_threshold', 10.0),
            redThreshold: getParamNumber(s817, 'axon_stress_index_pct', 'red_threshold', 18.0),
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.35 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.85 + h.mitochondrialStress * 0.2;
              const mitigation =
                (cm['sans-ocular-scanner'] ? 0.55 : 0) +
                (cm['peptide-bioreactor'] ? 0.2 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(2.0, 14.5, eff) + Math.sin(t * 0.3) * 0.2;
            },
          },
          {
            id: 'visual_acuity_hyperopic_shift_D',
            label: 'Hyperopic Visual Shift',
            unit: 'D',
            studyId: 'OSD-817',
            paramKey: 'visual_acuity_hyperopic_shift_D',
            baseline: getParamNumber(s817, 'visual_acuity_hyperopic_shift_D', 'baseline', 0.0),
            inFlightExtreme: getParamNumber(s817, 'visual_acuity_hyperopic_shift_D', 'in_flight_peak', 0.75),
            yellowThreshold: getParamNumber(s817, 'visual_acuity_hyperopic_shift_D', 'yellow_threshold', 0.5),
            redThreshold: getParamNumber(s817, 'visual_acuity_hyperopic_shift_D', 'red_threshold', 1.0),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.35 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.9;
              const mitigation = cm['sans-ocular-scanner'] ? 0.65 : 0;
              const eff = clamp(drive - mitigation, 0, 1.4);
              return lerp(0.0, 0.75, eff);
            },
          },
        ],
      },
      {
        id: 'biomarker-analyzer',
        index: 7,
        name: 'Biomarker Blood/Saliva Analyzer',
        shortName: 'Biomarker Lab',
        bayLocation: 'Port Aft Hematology Rack',
        roleSummary:
          'Automated Sysmex-grade Complete Blood Count (CBC), neutrophil-to-lymphocyte ratio, and hemoconcentration.',
        position3D: [-4.0, 0, 1.7],
        rotationY: Math.PI / 2,
        cameraOffset: [2.4, 1.7, -1.2],
        studyIds: ['OSD-569'],
        upstreamTerminalIds: ['radiation-console', 'lbnp-unit'],
        downstreamTerminalIds: ['bio-scanner-bed'],
        countermeasure: {
          id: 'immune-antioxidant-regimen',
          label: 'Administer Targeted Antioxidant & Immune Modulation',
          shortLabel: 'Immune Regimen',
          description:
            'Dispenses oral polyphenol-glutathione complex and modulates acute neutrophil mobilization triggered by spaceflight stress.',
          affectedStudies: ['OSD-569', 'OSD-530'],
          affectedTerminals: ['biomarker-analyzer', 'bio-scanner-bed'],
        },
        metrics: [
          {
            id: 'wbc_count_10e3_uL',
            label: 'White Blood Cell (WBC)',
            unit: '×10³/µL',
            studyId: 'OSD-569',
            paramKey: 'wbc_count_10e3_uL',
            baseline: getParamNumber(s569, 'wbc_count_10e3_uL', 'baseline', 6.4),
            inFlightExtreme: getParamNumber(s569, 'wbc_count_10e3_uL', 'in_flight_peak', 9.8),
            yellowThreshold: getParamNumber(s569, 'wbc_count_10e3_uL', 'yellow_threshold', 9.5),
            redThreshold: getParamNumber(s569, 'wbc_count_10e3_uL', 'red_threshold', 11.5),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = radFactor * 0.6 + h.microgravityFluidShift * 0.4 + h.isolationCircadianLoad * 0.25;
              const mitigation =
                (cm['biomarker-analyzer'] ? 0.6 : 0) +
                (cm['peptide-bioreactor'] ? 0.2 : 0);
              const eff = clamp(drive - mitigation, 0, 1.45);
              return lerp(6.4, 9.8, eff) + Math.sin(t * 0.45) * 0.08;
            },
          },
          {
            id: 'neutrophil_to_lymphocyte_ratio',
            label: 'Neutrophil-to-Lymphocyte Ratio',
            unit: 'NLR',
            studyId: 'OSD-569',
            paramKey: 'neutrophil_to_lymphocyte_ratio',
            baseline: getParamNumber(s569, 'neutrophil_to_lymphocyte_ratio', 'baseline', 1.8),
            inFlightExtreme: getParamNumber(s569, 'neutrophil_to_lymphocyte_ratio', 'in_flight_peak', 3.6),
            yellowThreshold: getParamNumber(s569, 'neutrophil_to_lymphocyte_ratio', 'yellow_threshold', 3.0),
            redThreshold: getParamNumber(s569, 'neutrophil_to_lymphocyte_ratio', 'red_threshold', 4.5),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = radFactor * 0.65 + h.isolationCircadianLoad * 0.45;
              const mitigation =
                (cm['biomarker-analyzer'] ? 0.65 : 0) +
                (cm['circadian-pod'] ? 0.2 : 0);
              const eff = clamp(drive - mitigation, 0, 1.45);
              return lerp(1.8, 3.6, eff) + Math.cos(t * 0.4) * 0.04;
            },
          },
          {
            id: 'hemoglobin_g_dL',
            label: 'Hemoglobin (Hemoconcentration)',
            unit: 'g/dL',
            studyId: 'OSD-569',
            paramKey: 'hemoglobin_g_dL',
            baseline: getParamNumber(s569, 'hemoglobin_g_dL', 'baseline', 14.5),
            inFlightExtreme: getParamNumber(s569, 'hemoglobin_g_dL', 'in_flight_peak', 15.8),
            yellowThreshold: getParamNumber(s569, 'hemoglobin_g_dL', 'yellow_threshold', 16.0),
            redThreshold: getParamNumber(s569, 'hemoglobin_g_dL', 'red_threshold', 17.5),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const fluidFactor = cm['lbnp-unit'] ? h.microgravityFluidShift * 0.3 : h.microgravityFluidShift;
              const drive = fluidFactor * 0.95;
              const mitigation = cm['biomarker-analyzer'] ? 0.35 : 0;
              const eff = clamp(drive - mitigation, 0, 1.5);
              return lerp(14.5, 15.8, eff) + Math.sin(t * 0.3) * 0.03;
            },
          },
        ],
      },
      {
        id: 'lbnp-unit',
        index: 8,
        name: 'LBNP Fluid Countermeasure Unit',
        shortName: 'LBNP Cylinder',
        bayLocation: 'Center-Aft Fluid Balance Bay',
        roleSummary:
          'Lower Body Negative Pressure chamber reversing cephalad fluid shift, plasma loss, and renal concentration.',
        position3D: [0.3, 0, 1.2],
        rotationY: 0,
        cameraOffset: [2.7, 1.9, 2.7],
        studyIds: ['OSD-656'],
        upstreamTerminalIds: [],
        downstreamTerminalIds: [
          'sans-ocular-scanner',
          'vascular-ultrasound',
          'bio-scanner-bed',
          'biomarker-analyzer',
        ],
        countermeasure: {
          id: 'lbnp-cylinder',
          label: 'Activate LBNP Cylinder (-35 mmHg) & Fluid Loading',
          shortLabel: 'LBNP -35 mmHg',
          description:
            'Draws blood volume caudally into the lower extremities, restoring central venous/ICP equilibrium and stabilizing SANS ocular and vascular cascades.',
          affectedStudies: ['OSD-656', 'OSD-816', 'OSD-817', 'OSD-575'],
          affectedTerminals: [
            'lbnp-unit',
            'sans-ocular-scanner',
            'vascular-ultrasound',
            'bio-scanner-bed',
            'biomarker-analyzer',
          ],
        },
        metrics: [
          {
            id: 'urinary_osmolarity_mOsm_kg',
            label: 'Urinary Osmolarity',
            unit: 'mOsm/kg',
            studyId: 'OSD-656',
            paramKey: 'urinary_osmolarity_mOsm_kg',
            baseline: getParamNumber(s656, 'urinary_osmolarity_mOsm_kg', 'baseline', 580),
            inFlightExtreme: getParamNumber(s656, 'urinary_osmolarity_mOsm_kg', 'in_flight_peak', 840),
            yellowThreshold: getParamNumber(s656, 'urinary_osmolarity_mOsm_kg', 'yellow_threshold', 750),
            redThreshold: getParamNumber(s656, 'urinary_osmolarity_mOsm_kg', 'red_threshold', 900),
            direction: 'higher_worse',
            decimals: 0,
            computeTarget: (h, cm, t) => {
              const drive = h.microgravityFluidShift * 0.92;
              const mitigation = cm['lbnp-unit'] ? 0.68 : 0;
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(580, 840, eff) + Math.sin(t * 0.35) * 4;
            },
          },
          {
            id: 'renal_inflammation_npq_delta',
            label: 'Renal Inflammation (NPQ Δ)',
            unit: 'log2 NPQ',
            studyId: 'OSD-656',
            paramKey: 'renal_inflammation_npq_delta',
            baseline: getParamNumber(s656, 'renal_inflammation_npq_delta', 'baseline', 0.0),
            inFlightExtreme: getParamNumber(s656, 'renal_inflammation_npq_delta', 'in_flight_peak', 1.65),
            yellowThreshold: getParamNumber(s656, 'renal_inflammation_npq_delta', 'yellow_threshold', 1.2),
            redThreshold: getParamNumber(s656, 'renal_inflammation_npq_delta', 'red_threshold', 2.0),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const drive = h.microgravityFluidShift * 0.8 + h.mitochondrialStress * 0.25;
              const mitigation =
                (cm['lbnp-unit'] ? 0.55 : 0) +
                (cm['peptide-bioreactor'] ? 0.25 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(0.0, 1.65, eff) + Math.cos(t * 0.4) * 0.03;
            },
          },
          {
            id: 'plasma_volume_reduction_pct',
            label: 'Plasma Volume Delta',
            unit: '%',
            studyId: 'OSD-656',
            paramKey: 'plasma_volume_reduction_pct',
            baseline: getParamNumber(s656, 'plasma_volume_reduction_pct', 'baseline', 0),
            inFlightExtreme: getParamNumber(s656, 'plasma_volume_reduction_pct', 'in_flight_peak', -12),
            yellowThreshold: getParamNumber(s656, 'plasma_volume_reduction_pct', 'yellow_threshold', -10),
            redThreshold: getParamNumber(s656, 'plasma_volume_reduction_pct', 'red_threshold', -15),
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const drive = h.microgravityFluidShift * 0.95;
              const mitigation = cm['lbnp-unit'] ? 0.72 : 0;
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(0, -12, eff) + Math.sin(t * 0.3) * 0.15;
            },
          },
        ],
      },
      {
        id: 'pharma-locker',
        index: 9,
        name: 'Pharmacology Stability Locker',
        shortName: 'Pharma Locker',
        bayLocation: 'Starboard Aft Cold-Chain Rack',
        roleSummary:
          'Monitors radiation-induced radiolytic degradation and cryo-thermal stability of onboard therapeutics.',
        position3D: [4.0, 0, 1.7],
        rotationY: -Math.PI / 2,
        cameraOffset: [-2.4, 1.7, -1.2],
        studyIds: ['OSD-984', 'OSD-656'],
        upstreamTerminalIds: ['radiation-console'],
        downstreamTerminalIds: ['biomarker-analyzer', 'peptide-bioreactor'],
        countermeasure: {
          id: 'pharma-cryo-vault',
          label: 'Seal Cryo-Lead Vault & Stabilize Cold Chain',
          shortLabel: 'Cryo-Lead Vault',
          description:
            'Engages lead-borated polyethylene inner shielding and auxiliary Peltier cryo-loop to halt radiolytic pharmaceutical degradation.',
          affectedStudies: ['OSD-984'],
          affectedTerminals: ['pharma-locker'],
        },
        metrics: [
          {
            id: 'active_compound_potency_pct',
            label: 'Active Compound Potency',
            unit: '%',
            studyId: 'OSD-984',
            paramKey: 'cumulative_gcr_dose_mSv',
            baseline: 99.4,
            inFlightExtreme: 83.0,
            yellowThreshold: 90.0,
            redThreshold: 82.0,
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.32 : h.radiationExposure;
              const drive = radFactor * 0.85;
              const mitigation = cm['pharma-locker'] ? 0.75 : 0;
              const eff = clamp(drive - mitigation, 0, 1.25);
              return lerp(99.4, 83.0, eff) + Math.sin(t * 0.2) * 0.15;
            },
          },
          {
            id: 'radiolytic_impurity_pct',
            label: 'Radiolytic Impurity Fraction',
            unit: '%',
            studyId: 'OSD-984',
            paramKey: 'cumulative_gcr_dose_mSv',
            baseline: 0.4,
            inFlightExtreme: 6.2,
            yellowThreshold: 3.5,
            redThreshold: 6.5,
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.32 : h.radiationExposure;
              const drive = radFactor * 0.85;
              const mitigation = cm['pharma-locker'] ? 0.72 : 0;
              const eff = clamp(drive - mitigation, 0, 1.3);
              return lerp(0.4, 6.2, eff) + Math.cos(t * 0.25) * 0.05;
            },
          },
          {
            id: 'cryo_storage_temp_C',
            label: 'Cryo Locker Core Temp',
            unit: '°C',
            studyId: 'OSD-656',
            paramKey: 'urinary_osmolarity_mOsm_kg',
            baseline: 4.0,
            inFlightExtreme: 7.8,
            yellowThreshold: 6.0,
            redThreshold: 8.0,
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const drive = h.mitochondrialStress * 0.45 + h.radiationExposure * 0.45;
              const mitigation = cm['pharma-locker'] ? 0.75 : 0;
              const eff = clamp(drive - mitigation, 0, 1.3);
              return lerp(4.0, 7.8, eff) + Math.sin(t * 0.5) * 0.08;
            },
          },
        ],
      },
      {
        id: 'neural-sleep-modulator',
        index: 10,
        name: 'Autonomous AI Neural Sleep Modulator',
        shortName: 'Neural Modulator',
        bayLocation: 'Port Aft Neuro-Cognition Bay',
        roleSummary:
          'Psychomotor vigilance (PVT), dopaminergic cortex tracking, and cortical neuroinflammation modulator.',
        position3D: [-2.6, 0, 4.1],
        rotationY: Math.PI / 5,
        cameraOffset: [2.2, 1.8, -2.5],
        studyIds: ['OSD-897', 'OSD-941'],
        upstreamTerminalIds: ['radiation-console', 'circadian-pod', 'bio-scanner-bed'],
        downstreamTerminalIds: [],
        countermeasure: {
          id: 'neural-sleep-entrainment',
          label: 'Run Closed-Loop Slow-Wave Neural Entrainment',
          shortLabel: 'Neural Entrainment',
          description:
            'Delivers phase-locked acoustic pink-noise pulses and cranial micro-stimulation to preserve dopaminergic signaling and suppress neuroinflammation.',
          affectedStudies: ['OSD-897', 'OSD-941'],
          affectedTerminals: ['neural-sleep-modulator', 'circadian-pod'],
        },
        metrics: [
          {
            id: 'pvt_reaction_time_ms',
            label: 'PVT Reaction Time',
            unit: 'ms',
            studyId: 'OSD-897',
            paramKey: 'pvt_reaction_time_ms',
            baseline: getParamNumber(s897, 'pvt_reaction_time_ms', 'baseline', 245),
            inFlightExtreme: getParamNumber(s897, 'pvt_reaction_time_ms', 'in_flight_peak', 340),
            yellowThreshold: getParamNumber(s897, 'pvt_reaction_time_ms', 'yellow_threshold', 300),
            redThreshold: getParamNumber(s897, 'pvt_reaction_time_ms', 'red_threshold', 360),
            direction: 'higher_worse',
            decimals: 0,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = radFactor * 0.68 + h.isolationCircadianLoad * 0.42;
              const mitigation =
                (cm['neural-sleep-modulator'] ? 0.62 : 0) +
                (cm['circadian-pod'] ? 0.22 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(245, 340, eff) + Math.sin(t * 0.6) * 2.5;
            },
          },
          {
            id: 'attention_lapses_per_session',
            label: 'PVT Attention Lapses',
            unit: '/sess',
            studyId: 'OSD-897',
            paramKey: 'attention_lapses_per_session',
            baseline: getParamNumber(s897, 'attention_lapses_per_session', 'baseline', 1),
            inFlightExtreme: getParamNumber(s897, 'attention_lapses_per_session', 'in_flight_peak', 7),
            yellowThreshold: getParamNumber(s897, 'attention_lapses_per_session', 'yellow_threshold', 4),
            redThreshold: getParamNumber(s897, 'attention_lapses_per_session', 'red_threshold', 8),
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = radFactor * 0.65 + h.isolationCircadianLoad * 0.4;
              const mitigation =
                (cm['neural-sleep-modulator'] ? 0.65 : 0) +
                (cm['circadian-pod'] ? 0.2 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(1, 7, eff) + Math.cos(t * 0.45) * 0.15;
            },
          },
          {
            id: 'dopaminergic_signaling_index',
            label: 'Dopaminergic Signaling Index',
            unit: '%',
            studyId: 'OSD-897',
            paramKey: 'dopaminergic_signaling_index',
            baseline: getParamNumber(s897, 'dopaminergic_signaling_index', 'baseline', 100),
            inFlightExtreme: getParamNumber(s897, 'dopaminergic_signaling_index', 'in_flight_drop', 79),
            yellowThreshold: getParamNumber(s897, 'dopaminergic_signaling_index', 'yellow_threshold', 82),
            redThreshold: getParamNumber(s897, 'dopaminergic_signaling_index', 'red_threshold', 72),
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const radFactor = cm['radiation-console'] ? h.radiationExposure * 0.35 : h.radiationExposure;
              const drive = radFactor * 0.72 + h.mitochondrialStress * 0.3;
              const mitigation = cm['neural-sleep-modulator'] ? 0.68 : 0;
              const eff = clamp(drive - mitigation, 0, 1.4);
              return lerp(100, 79, eff) + Math.sin(t * 0.3) * 0.3;
            },
          },
          {
            id: 'neuroinflammatory_pathway_zscore',
            label: 'Cortical Neuroinflammation',
            unit: 'Z-score',
            studyId: 'OSD-941',
            paramKey: 'neuroinflammatory_pathway_zscore',
            baseline: getParamNumber(s941, 'neuroinflammatory_pathway_zscore', 'baseline', 0.0),
            inFlightExtreme: getParamNumber(s941, 'neuroinflammatory_pathway_zscore', 'in_flight_peak', 1.9),
            yellowThreshold: getParamNumber(s941, 'neuroinflammatory_pathway_zscore', 'yellow_threshold', 1.5),
            redThreshold: getParamNumber(s941, 'neuroinflammatory_pathway_zscore', 'red_threshold', 2.2),
            direction: 'higher_worse',
            decimals: 2,
            computeTarget: (h, cm, t) => {
              const drive = h.mitochondrialStress * 0.6 + h.radiationExposure * 0.45;
              const mitigation =
                (cm['neural-sleep-modulator'] ? 0.45 : 0) +
                (cm['peptide-bioreactor'] ? 0.45 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(0.0, 1.9, eff) + Math.cos(t * 0.35) * 0.03;
            },
          },
          {
            id: 'synaptic_plasticity_expression_pct',
            label: 'Synaptic Plasticity Expression',
            unit: '%',
            studyId: 'OSD-941',
            paramKey: 'synaptic_plasticity_expression_pct',
            baseline: getParamNumber(s941, 'synaptic_plasticity_expression_pct', 'baseline', 100),
            inFlightExtreme: getParamNumber(s941, 'synaptic_plasticity_expression_pct', 'in_flight_drop', 82),
            yellowThreshold: getParamNumber(s941, 'synaptic_plasticity_expression_pct', 'yellow_threshold', 85),
            redThreshold: getParamNumber(s941, 'synaptic_plasticity_expression_pct', 'red_threshold', 75),
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const drive = h.mitochondrialStress * 0.55 + h.isolationCircadianLoad * 0.45;
              const mitigation =
                (cm['neural-sleep-modulator'] ? 0.55 : 0) +
                (cm['peptide-bioreactor'] ? 0.3 : 0);
              const eff = clamp(drive - mitigation, 0, 1.4);
              return lerp(100, 82, eff) + Math.sin(t * 0.4) * 0.3;
            },
          },
          {
            id: 'neural_metabolic_fatigue_index',
            label: 'Neural Metabolic Fatigue',
            unit: 'index',
            studyId: 'OSD-941',
            paramKey: 'neural_metabolic_fatigue_index',
            baseline: getParamNumber(s941, 'neural_metabolic_fatigue_index', 'baseline', 12),
            inFlightExtreme: getParamNumber(s941, 'neural_metabolic_fatigue_index', 'in_flight_peak', 44),
            yellowThreshold: getParamNumber(s941, 'neural_metabolic_fatigue_index', 'yellow_threshold', 35),
            redThreshold: getParamNumber(s941, 'neural_metabolic_fatigue_index', 'red_threshold', 50),
            direction: 'higher_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const drive = h.mitochondrialStress * 0.5 + h.isolationCircadianLoad * 0.55;
              const mitigation =
                (cm['neural-sleep-modulator'] ? 0.55 : 0) +
                (cm['circadian-pod'] ? 0.25 : 0);
              const eff = clamp(drive - mitigation, 0, 1.35);
              return lerp(12, 44, eff) + Math.sin(t * 0.5) * 0.4;
            },
          },
        ],
      },
      {
        id: 'peptide-bioreactor',
        index: 11,
        name: 'Synthetic Peptide Bioreactor',
        shortName: 'Peptide Bioreactor',
        bayLocation: 'Starboard Aft Synthesis Alcove',
        roleSummary:
          'Perfusion bioreactor synthesizing mitochondrial-protective & anti-neuroinflammatory peptides on orbit.',
        position3D: [2.7, 0, 4.1],
        rotationY: -Math.PI / 5,
        cameraOffset: [-2.2, 1.8, -2.5],
        studyIds: ['OSD-530', 'OSD-941', 'OSD-984'],
        upstreamTerminalIds: ['pharma-locker'],
        downstreamTerminalIds: [
          'bio-scanner-bed',
          'rehab-terminal',
          'neural-sleep-modulator',
        ],
        countermeasure: {
          id: 'peptide-bioreactor-run',
          label: 'Run Synthetic Peptide Synthesis & Perfusion Cycle',
          shortLabel: 'Run Bioreactor',
          description:
            'Synthesizes SS-31 mitochondrial cardiolipin-stabilizing peptides to suppress exMT cfRNA release, oxidative stress, neuroinflammation, and muscle proteolysis.',
          affectedStudies: ['OSD-530', 'OSD-941', 'OSD-575', 'OSD-984'],
          affectedTerminals: [
            'peptide-bioreactor',
            'bio-scanner-bed',
            'rehab-terminal',
            'neural-sleep-modulator',
          ],
        },
        metrics: [
          {
            id: 'mitochondrial_repair_peptide_mg_L',
            label: 'Mito-Repair Peptide Output',
            unit: 'mg/L',
            studyId: 'OSD-530',
            paramKey: 'cellular_homeostasis_index',
            baseline: 18.0,
            inFlightExtreme: 7.2,
            yellowThreshold: 10.5,
            redThreshold: 7.5,
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              if (cm['peptide-bioreactor']) {
                return 38.4 + Math.sin(t * 0.8) * 0.6;
              }
              const drive = h.mitochondrialStress * 0.7 + h.radiationExposure * 0.35;
              const eff = clamp(drive, 0, 1.2);
              return lerp(18.0, 7.2, eff) + Math.cos(t * 0.4) * 0.25;
            },
          },
          {
            id: 'peptide_yield_purity_pct',
            label: 'Synthesis Purity Yield',
            unit: '%',
            studyId: 'OSD-941',
            paramKey: 'synaptic_plasticity_expression_pct',
            baseline: 96.5,
            inFlightExtreme: 79.0,
            yellowThreshold: 88.0,
            redThreshold: 78.0,
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const drive = h.radiationExposure * 0.55 + h.mitochondrialStress * 0.45;
              const mitigation = cm['peptide-bioreactor'] ? 0.72 : 0;
              const eff = clamp(drive - mitigation, 0, 1.2);
              return lerp(96.5, 79.0, eff) + Math.sin(t * 0.3) * 0.2;
            },
          },
          {
            id: 'bioreactor_perfusion_stability_pct',
            label: 'Perfusion Flow Stability',
            unit: '%',
            studyId: 'OSD-984',
            paramKey: 'skeletal_muscle_mass_loss_pct',
            baseline: 98.0,
            inFlightExtreme: 80.5,
            yellowThreshold: 88.0,
            redThreshold: 78.0,
            direction: 'lower_worse',
            decimals: 1,
            computeTarget: (h, cm, t) => {
              const drive = h.microgravityFluidShift * 0.55 + h.mitochondrialStress * 0.45;
              const mitigation = cm['peptide-bioreactor'] ? 0.68 : 0;
              const eff = clamp(drive - mitigation, 0, 1.2);
              return lerp(98.0, 80.5, eff) + Math.cos(t * 0.5) * 0.2;
            },
          },
        ],
      },
    ];
  }

  private appendMissionLog(entry: {
    category: MissionLogCategory;
    severity: AlertLevel;
    title: string;
    summaryLine: string;
    reportText: string;
    citedStudies: string[];
    affectedTerminals: string[];
  }): void {
    this.logCounter += 1;
    const item: MissionLogEntry = {
      id: `log-${this.logCounter}-${Date.now()}`,
      timestamp: Date.now(),
      missionElapsedSec: Math.floor(this.missionElapsedSec),
      scenario: this.scenario,
      category: entry.category,
      severity: entry.severity,
      title: entry.title,
      summaryLine: entry.summaryLine,
      reportText: entry.reportText,
      citedStudies: entry.citedStudies,
      affectedTerminals: entry.affectedTerminals,
    };
    this.missionLogs = [item, ...this.missionLogs].slice(0, 40);
  }

  triggerScenario(scenario: HazardScenarioId): void {
    if (this.scenario === scenario) return;
    this.scenario = scenario;
    this.scenarioStartTime = this.missionElapsedSec;
    this.generateScenarioFlightSurgeonReport(scenario);
  }

  private generateScenarioFlightSurgeonReport(scenario: HazardScenarioId): void {
    switch (scenario) {
      case 'solar_particle_event':
        this.appendMissionLog({
          category: 'SCENARIO_REPORT',
          severity: 'RED',
          title: 'Flight Surgeon Advisory: Solar Particle Event (SPE) & HZE Radiation Surge',
          summaryLine: 'Acute ionizing proton/GCR spike driving multi-system hematologic, neural, and musculoskeletal cascades.',
          reportText:
            'CHIEF FLIGHT SURGEON ASSESSMENT — SOLAR PARTICLE EVENT:\n' +
            '1. PRIMARY HAZARD: Cabin ionizing radiation flux and cumulative GCR/SPE dose (OSD-984) are climbing rapidly toward mission alert thresholds (150–300 mSv). Radiolytic degradation risk is elevated in the Pharmacology Stability Locker.\n' +
            '2. INTERCONNECTED CASCADES: Proton irradiation disrupts frontal/parietal dopaminergic signaling and degrades Psychomotor Vigilance Test (PVT) reaction times (OSD-897). Concurrent immune stress drives acute leukocyte mobilization and elevated neutrophil-to-lymphocyte ratio (OSD-569), while impairing REM sleep efficiency (OSD-1018) and skeletal muscle mitochondrial protein synthesis (OSD-984).\n' +
            '3. COUNTERMEASURE DIRECTIVE: Immediately deploy Water-Wall Storm Shielding on the Radiation Console, seal the Cryo-Lead Pharma Vault, and engage Closed-Loop Neural Entrainment.',
          citedStudies: ['OSD-984', 'OSD-897', 'OSD-569', 'OSD-1018'],
          affectedTerminals: [
            'radiation-console',
            'neural-sleep-modulator',
            'biomarker-analyzer',
            'rehab-terminal',
            'circadian-pod',
            'pharma-locker',
          ],
        });
        break;

      case 'cephalad_fluid_shift':
        this.appendMissionLog({
          category: 'SCENARIO_REPORT',
          severity: 'RED',
          title: 'Flight Surgeon Assessment: Acute Cephalad Fluid Shift & SANS Progression',
          summaryLine: 'Microgravity fluid redistribution elevating ICP:IOP translaminar gradient and retinal edema.',
          reportText:
            'CHIEF FLIGHT SURGEON ASSESSMENT — CEPHALAD FLUID SHIFT:\n' +
            '1. PRIMARY HAZARD: Microgravity-induced diuresis and central fluid redistribution have reduced plasma volume toward -12% while concentrating urinary osmolarity and renal inflammatory proteins (OSD-656).\n' +
            '2. INTERCONNECTED CASCADES: Elevated intracranial pressure relative to intraocular pressure (ICP:IOP shifting toward 15:16 mmHg) flattens the posterior globe, thickening retinal nerve fibers and depressing ERG b-wave amplitude (OSD-816). Sustained translaminar pressure imbalance induces Frisén Grade 1–2 optic disc edema and hyperopic visual shift (OSD-817), alongside jugular venous stasis and elevated cardiac troponin/IL-6 (OSD-575).\n' +
            '3. COUNTERMEASURE DIRECTIVE: Activate the LBNP Cylinder (-35 mmHg) to pull fluid caudally, engage SANS Translaminar Pressure Goggles, and apply Venous Compression Cuffs.',
          citedStudies: ['OSD-656', 'OSD-816', 'OSD-817', 'OSD-575'],
          affectedTerminals: [
            'lbnp-unit',
            'sans-ocular-scanner',
            'vascular-ultrasound',
            'bio-scanner-bed',
          ],
        });
        break;

      case 'long_duration_fatigue':
        this.appendMissionLog({
          category: 'SCENARIO_REPORT',
          severity: 'YELLOW',
          title: 'Flight Surgeon Report: Long-Duration (>120d) Mitochondrial & Unloading Fatigue',
          summaryLine: 'Sustained orbital unloading driving exMT cfRNA release, cortical neuroinflammation, and atrophy.',
          reportText:
            'CHIEF FLIGHT SURGEON ASSESSMENT — LONG-DURATION (>120D) STRESS:\n' +
            '1. PRIMARY HAZARD: Extended microgravity unloading (>120 days) is disrupting systemic mitochondrial homeostasis, elevating circulating CD36+ extracellular mitochondrial cfRNA and oxidative stress transcripts (OSD-530).\n' +
            '2. INTERCONNECTED CASCADES: Systemic metabolic and oxidative stress amplifies cortical neuroinflammatory pathways (Z-score >1.5) and suppresses synaptic plasticity expression (OSD-941), compounding REM sleep loss and salivary cortisol elevation (OSD-1018). Concurrently, skeletal muscle mass and bone mineral density exhibit accelerated catabolic decline (OSD-984).\n' +
            '3. COUNTERMEASURE DIRECTIVE: Initiate a Synthetic Peptide Bioreactor synthesis cycle, enforce ARED resistive loading, and engage 480nm Circadian Phototherapy.',
          citedStudies: ['OSD-530', 'OSD-941', 'OSD-984', 'OSD-1018'],
          affectedTerminals: [
            'bio-scanner-bed',
            'peptide-bioreactor',
            'neural-sleep-modulator',
            'rehab-terminal',
            'circadian-pod',
          ],
        });
        break;

      case 'cascade_crisis':
        this.appendMissionLog({
          category: 'SCENARIO_REPORT',
          severity: 'RED',
          title: 'EMERGENCY FLIGHT SURGEON BULLETIN: Multi-Hazard Orbital Cascade',
          summaryLine: 'Simultaneous SPE radiation, cephalad fluid shift, and mitochondrial fatigue across all 11 stations.',
          reportText:
            'EMERGENCY FLIGHT SURGEON BULLETIN — MULTI-SYSTEM CASCADE:\n' +
            '1. SITUATION: Concurrent Solar Particle Event ionizing flux (OSD-984, OSD-897), acute cephalad fluid shift (OSD-656, OSD-816, OSD-817), and long-duration mitochondrial dysregulation (OSD-530, OSD-941) are triggering cross-bay secondary risk escalations across all 11 terminals.\n' +
            '2. PRIORITY TRIAGE: Stabilize upstream root drivers first — (a) Deploy Water-Wall Storm Shielding on Radiation Console, (b) Activate LBNP Cylinder (-35 mmHg) to relieve SANS ocular & vascular pressure, and (c) Run the Synthetic Peptide Bioreactor to suppress systemic cfRNA oxidative stress and neuroinflammation.\n' +
            '3. SECONDARY SUPPORT: Engage ARED Rehab, SANS Goggles, Immune Antioxidant Regimen, and Cryo-Lead Pharma Vault until all stations return to NOMINAL.',
          citedStudies: [
            'OSD-984',
            'OSD-897',
            'OSD-656',
            'OSD-816',
            'OSD-817',
            'OSD-530',
            'OSD-941',
            'OSD-575',
            'OSD-569',
            'OSD-1018',
          ],
          affectedTerminals: this.terminalConfigs.map((t) => t.id),
        });
        break;

      case 'nominal':
      default:
        this.appendMissionLog({
          category: 'SCENARIO_REPORT',
          severity: 'NOMINAL',
          title: 'Flight Surgeon Update: Return to Nominal Orbital Profile',
          summaryLine: 'External hazard injection cleared; physiological vitals converging toward baseline.',
          reportText:
            'MEDICAL OFFICER LOG — NOMINAL ORBITAL PROFILE:\n' +
            'Orbital environmental drivers have returned to nominal baseline conditions. Continue monitoring residual fluid balance (OSD-656), ocular translaminar gradient (OSD-816), and hematologic markers (OSD-569) until full recovery is confirmed.',
          citedStudies: ['OSD-656', 'OSD-816', 'OSD-569'],
          affectedTerminals: ['bio-scanner-bed', 'lbnp-unit', 'radiation-console'],
        });
        break;
    }
  }

  generateLiveSituationReport(): void {
    const activeAlerts: string[] = [];
    const cited = new Set<string>();
    const affected = new Set<string>();
    const engagedCms: string[] = [];
    let worst: AlertLevel = 'NOMINAL';

    for (const cfg of this.terminalConfigs) {
      if (this.countermeasures[cfg.id]) {
        engagedCms.push(`${cfg.shortName} (${cfg.countermeasure.shortLabel})`);
      }
      for (const m of cfg.metrics) {
        const val = this.metricValues[m.id] ?? m.baseline;
        const st = evaluateStatus(val, m.yellowThreshold, m.redThreshold, m.direction);
        if (st !== 'NOMINAL') {
          if (st === 'RED') worst = 'RED';
          else if (worst === 'NOMINAL') worst = 'YELLOW';
          const disp = m.formatFn ? m.formatFn(val) : val.toFixed(m.decimals);
          activeAlerts.push(`• ${cfg.shortName} — ${m.label}: ${disp} ${m.unit} [${st}, ${m.studyId}]`);
          cited.add(m.studyId);
          affected.add(cfg.id);
        }
      }
    }

    const reportLines = [
      `ON-DEMAND FLIGHT SURGEON SITUATION REPORT (SCENARIO: ${this.scenario.toUpperCase()}):`,
      `• Overall Medical Bay Status: ${worst} (${activeAlerts.length} threshold breach${activeAlerts.length === 1 ? '' : 'es'})`,
      `• Active Countermeasures (${engagedCms.length}/11): ${engagedCms.length > 0 ? engagedCms.join(', ') : 'None engaged'}`,
      activeAlerts.length > 0
        ? `• Threshold Exceptions:\n${activeAlerts.slice(0, 6).join('\n')}${activeAlerts.length > 6 ? `\n  ...and ${activeAlerts.length - 6} additional parameters` : ''}`
        : '• All monitored physiological metrics across the 11 stations are currently within NASA OSDR nominal tolerances.',
    ];

    this.appendMissionLog({
      category: 'SCENARIO_REPORT',
      severity: worst,
      title: `Live Flight Surgeon SitRep — ${worst} Status`,
      summaryLine: `${activeAlerts.length} active breaches · ${engagedCms.length}/11 countermeasures engaged.`,
      reportText: reportLines.join('\n'),
      citedStudies: Array.from(cited),
      affectedTerminals: Array.from(affected),
    });
  }

  toggleCountermeasure(terminalId: string, active: boolean): void {
    if (terminalId in this.countermeasures) {
      const wasActive = this.countermeasures[terminalId];
      this.countermeasures[terminalId] = active;
      if (wasActive !== active) {
        const cfg = this.terminalConfigs.find((t) => t.id === terminalId);
        if (cfg) {
          this.appendMissionLog({
            category: 'COUNTERMEASURE',
            severity: 'NOMINAL',
            title: active
              ? `Countermeasure Engaged: ${cfg.countermeasure.shortLabel}`
              : `Countermeasure Standby: ${cfg.countermeasure.shortLabel}`,
            summaryLine: `${cfg.name} countermeasure ${active ? 'activated' : 'placed on standby'}.`,
            reportText: active
              ? `COUNTERMEASURE EXECUTION LOG — ${cfg.name.toUpperCase()}:\n` +
                `Protocol "${cfg.countermeasure.label}" engaged. ${cfg.countermeasure.description}\n` +
                `Expected stabilization across studies: ${cfg.countermeasure.affectedStudies.join(', ')}.`
              : `COUNTERMEASURE STANDBY LOG — ${cfg.name.toUpperCase()}:\n` +
                `Protocol "${cfg.countermeasure.shortLabel}" placed on standby. Telemetry monitoring continues for rebound drift.`,
            citedStudies: cfg.countermeasure.affectedStudies,
            affectedTerminals: cfg.countermeasure.affectedTerminals,
          });
        }
      }
    }
  }

  setSpeed(speed: number): void {
    this.speedMultiplier = clamp(speed, 1, 10);
  }

  resetToNominal(): void {
    this.scenario = 'nominal';
    this.speedMultiplier = 1;
    for (const key of Object.keys(this.countermeasures)) {
      this.countermeasures[key] = false;
    }
    this.hazards = {
      radiationExposure: 0.2,
      microgravityFluidShift: 0.22,
      mitochondrialStress: 0.18,
      isolationCircadianLoad: 0.16,
    };
    this.appendMissionLog({
      category: 'RECOVERY',
      severity: 'NOMINAL',
      title: 'Telemetry Reset — Baseline Equilibrium Restored',
      summaryLine: 'All hazard drivers and countermeasures reset to orbital baseline.',
      reportText:
        'MEDICAL SYSTEM RESET:\nAll simulated hazard scenarios and countermeasure overrides have been cleared. Bio-telemetry is returning to baseline orbital parameters.',
      citedStudies: ['OSD-575', 'OSD-656', 'OSD-984'],
      affectedTerminals: [],
    });
  }

  step(dtSeconds: number): TelemetrySnapshot {
    const dt = dtSeconds * this.speedMultiplier;
    this.missionElapsedSec += dt;
    this.seq += 1;

    const t = this.missionElapsedSec;
    // Target hazard drivers based on active scenario + gentle orbital cycles
    const orbitalWave = (Math.sin(t * 0.08) + 1) * 0.5;
    let targetHazards: HazardDrivers;

    switch (this.scenario) {
      case 'solar_particle_event':
        targetHazards = {
          radiationExposure: 1.08 + Math.sin(t * 0.25) * 0.08,
          microgravityFluidShift: 0.35 + orbitalWave * 0.1,
          mitochondrialStress: 0.62 + orbitalWave * 0.08,
          isolationCircadianLoad: 0.68 + orbitalWave * 0.06,
        };
        break;
      case 'cephalad_fluid_shift':
        targetHazards = {
          radiationExposure: 0.25 + orbitalWave * 0.06,
          microgravityFluidShift: 1.12 + Math.sin(t * 0.2) * 0.06,
          mitochondrialStress: 0.45 + orbitalWave * 0.08,
          isolationCircadianLoad: 0.32 + orbitalWave * 0.06,
        };
        break;
      case 'long_duration_fatigue':
        targetHazards = {
          radiationExposure: 0.58 + orbitalWave * 0.08,
          microgravityFluidShift: 0.72 + orbitalWave * 0.08,
          mitochondrialStress: 1.10 + Math.sin(t * 0.22) * 0.07,
          isolationCircadianLoad: 0.96 + orbitalWave * 0.08,
        };
        break;
      case 'cascade_crisis':
        targetHazards = {
          radiationExposure: 1.18 + Math.sin(t * 0.3) * 0.06,
          microgravityFluidShift: 1.15 + Math.cos(t * 0.25) * 0.06,
          mitochondrialStress: 1.14 + Math.sin(t * 0.2) * 0.06,
          isolationCircadianLoad: 1.05 + Math.cos(t * 0.22) * 0.06,
        };
        break;
      case 'nominal':
      default:
        // Subtle autonomous orbital oscillation that periodically nudges thresholds
        // when countermeasures aren't engaged
        targetHazards = {
          radiationExposure: 0.22 + orbitalWave * 0.14,
          microgravityFluidShift: 0.26 + Math.sin(t * 0.06 + 1.2) * 0.12 + 0.1,
          mitochondrialStress: 0.22 + Math.cos(t * 0.05) * 0.1 + 0.08,
          isolationCircadianLoad: 0.20 + Math.sin(t * 0.04 + 2.4) * 0.1 + 0.08,
        };
        break;
    }

    // Smoothly approach target hazard drivers
    const hazardRate = clamp(dt * 0.85, 0.02, 0.35);
    this.hazards.radiationExposure = lerp(
      this.hazards.radiationExposure,
      targetHazards.radiationExposure,
      hazardRate,
    );
    this.hazards.microgravityFluidShift = lerp(
      this.hazards.microgravityFluidShift,
      targetHazards.microgravityFluidShift,
      hazardRate,
    );
    this.hazards.mitochondrialStress = lerp(
      this.hazards.mitochondrialStress,
      targetHazards.mitochondrialStress,
      hazardRate,
    );
    this.hazards.isolationCircadianLoad = lerp(
      this.hazards.isolationCircadianLoad,
      targetHazards.isolationCircadianLoad,
      hazardRate,
    );

    const alerts: ActiveAlertDiagnostic[] = [];
    const terminals: TerminalSpec[] = [];
    const statusByTerminal: Record<string, AlertLevel> = {};

    const metricRate = clamp(dt * 1.15, 0.04, 0.45);

    for (const cfg of this.terminalConfigs) {
      const metricsOut: MetricTelemetry[] = [];
      const termStatuses: AlertLevel[] = [];

      for (const m of cfg.metrics) {
        const target = m.computeTarget(this.hazards, this.countermeasures, t);
        const prev = this.metricValues[m.id] ?? m.baseline;
        const next = lerp(prev, target, metricRate);
        this.metricValues[m.id] = next;

        const hist = this.metricHistory[m.id];
        hist.push(Number(next.toFixed(m.decimals)));
        if (hist.length > 30) hist.shift();

        const status = evaluateStatus(
          next,
          m.yellowThreshold,
          m.redThreshold,
          m.direction,
        );
        termStatuses.push(status);

        const displayValue = m.formatFn ? m.formatFn(next) : next.toFixed(m.decimals);

        metricsOut.push({
          id: m.id,
          label: m.label,
          unit: m.unit,
          studyId: m.studyId,
          value: Number(next.toFixed(m.decimals)),
          displayValue,
          baseline: m.baseline,
          inFlightExtreme: m.inFlightExtreme,
          yellowThreshold: m.yellowThreshold,
          redThreshold: m.redThreshold,
          direction: m.direction,
          status,
          history: [...hist],
        });

        if (status === 'YELLOW' || status === 'RED') {
          const study = this.studies[m.studyId];
          const threshVal = status === 'RED' ? m.redThreshold : m.yellowThreshold;
          const op = m.direction === 'higher_worse' ? '≥' : '≤';
          alerts.push({
            id: `${cfg.id}:${m.id}`,
            terminalId: cfg.id,
            terminalName: cfg.name,
            metricId: m.id,
            metricLabel: m.label,
            valueDisplay: `${displayValue} ${m.unit}`,
            thresholdDisplay: `${op} ${threshVal} ${m.unit}`,
            level: status,
            studyId: m.studyId,
            studyTitle: study.title,
            mission: study.mission,
            organism: study.organism,
            assays: study.assays,
            diagnosticExplanation: study.diagnostic_explanation,
            upstreamCause: this.describeUpstreamCause(cfg.id),
            recommendedCountermeasureId: cfg.countermeasure.id,
            recommendedCountermeasureLabel: cfg.countermeasure.shortLabel,
          });
        }
      }

      const termStatus = worstStatus(termStatuses);
      statusByTerminal[cfg.id] = termStatus;

      const isActive = Boolean(this.countermeasures[cfg.id]);

      terminals.push({
        id: cfg.id,
        index: cfg.index,
        name: cfg.name,
        shortName: cfg.shortName,
        bayLocation: cfg.bayLocation,
        roleSummary: cfg.roleSummary,
        position3D: cfg.position3D,
        rotationY: cfg.rotationY,
        cameraOffset: cfg.cameraOffset,
        studyIds: cfg.studyIds,
        upstreamTerminalIds: cfg.upstreamTerminalIds,
        downstreamTerminalIds: cfg.downstreamTerminalIds,
        status: termStatus,
        countermeasure: {
          id: cfg.countermeasure.id,
          terminalId: cfg.id,
          label: cfg.countermeasure.label,
          shortLabel: cfg.countermeasure.shortLabel,
          description: cfg.countermeasure.description,
          affectedStudies: cfg.countermeasure.affectedStudies,
          affectedTerminals: cfg.countermeasure.affectedTerminals,
          active: isActive,
          effectivenessPct: isActive ? 92 : 0,
        },
        metrics: metricsOut,
      });
    }

    const causalLinks = this.buildCausalLinks(statusByTerminal);
    const yellowCount = alerts.filter((a) => a.level === 'YELLOW').length;
    const redCount = alerts.filter((a) => a.level === 'RED').length;
    const overallStatus: AlertLevel =
      redCount > 0 ? 'RED' : yellowCount > 0 ? 'YELLOW' : 'NOMINAL';

    // Detect terminal status escalations & overall recovery for automated Flight Surgeon logging
    for (const cfg of this.terminalConfigs) {
      const prevSt = this.prevTerminalStatuses[cfg.id] ?? 'NOMINAL';
      const curSt = statusByTerminal[cfg.id];
      const escalated =
        (prevSt === 'NOMINAL' && (curSt === 'YELLOW' || curSt === 'RED')) ||
        (prevSt === 'YELLOW' && curSt === 'RED');

      if (escalated) {
        const termAlerts = alerts.filter((a) => a.terminalId === cfg.id && a.level === curSt);
        const leadAlert = termAlerts[0] ?? alerts.find((a) => a.terminalId === cfg.id);
        if (leadAlert) {
          this.appendMissionLog({
            category: 'THRESHOLD_BREACH',
            severity: curSt,
            title: `${curSt} Escalation: ${cfg.shortName} (${leadAlert.studyId})`,
            summaryLine: `${leadAlert.metricLabel} reached ${leadAlert.valueDisplay} (${leadAlert.thresholdDisplay}).`,
            reportText:
              `AUTOMATED THRESHOLD ESCALATION — ${cfg.name.toUpperCase()}:\n` +
              `Metric "${leadAlert.metricLabel}" crossed ${curSt} threshold at ${leadAlert.valueDisplay} (limit ${leadAlert.thresholdDisplay}).\n` +
              `BIOLOGICAL DIAGNOSTIC (${leadAlert.studyId}): ${leadAlert.diagnosticExplanation}\n` +
              `CAUSAL PATHWAY: ${leadAlert.upstreamCause}.\n` +
              `RECOMMENDED ACTION: Engage "${leadAlert.recommendedCountermeasureLabel}".`,
            citedStudies: [leadAlert.studyId],
            affectedTerminals: [cfg.id, ...cfg.downstreamTerminalIds],
          });
        }
      }
      this.prevTerminalStatuses[cfg.id] = curSt;
    }

    if (
      (this.prevOverallStatus === 'YELLOW' || this.prevOverallStatus === 'RED') &&
      overallStatus === 'NOMINAL'
    ) {
      this.appendMissionLog({
        category: 'RECOVERY',
        severity: 'NOMINAL',
        title: 'All Medical Bay Stations Stabilized — Nominal Status Restored',
        summaryLine: 'Active countermeasures successfully returned all 11 terminals below alert thresholds.',
        reportText:
          'FLIGHT SURGEON RECOVERY CONFIRMATION:\n' +
          'All physiological parameters across the 11 ISS Medical Bay stations have returned within nominal NASA OSDR tolerances following countermeasure intervention.',
        citedStudies: [],
        affectedTerminals: [],
      });
    }
    this.prevOverallStatus = overallStatus;

    // Sort RED alerts first
    alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'RED' ? -1 : 1));

    return {
      seq: this.seq,
      timestamp: Date.now(),
      missionElapsedSec: Math.floor(this.missionElapsedSec),
      scenario: this.scenario,
      speedMultiplier: this.speedMultiplier,
      overallStatus,
      yellowCount,
      redCount,
      hazards: { ...this.hazards },
      terminals,
      alerts,
      causalLinks,
      missionLogs: this.missionLogs,
      studies: this.studies,
    };
  }

  private describeUpstreamCause(terminalId: string): string {
    switch (terminalId) {
      case 'sans-ocular-scanner':
        return 'Driven by cephalad microgravity fluid shift from LBNP Fluid Balance & Vascular venous stasis';
      case 'vascular-ultrasound':
        return 'Coupled to central fluid redistribution & systemic inflammatory cytokine surge';
      case 'biomarker-analyzer':
        return 'Cascaded from ionizing radiation exposure & plasma volume hemoconcentration';
      case 'rehab-terminal':
        return 'Driven by combined HZE Galactic Cosmic Ray exposure & microgravity unloading';
      case 'circadian-pod':
        return 'Triggered by GCR radiation load & prolonged crew isolation architecture';
      case 'neural-sleep-modulator':
        return 'Cascaded from proton radiation flux, REM disruption, & systemic cfRNA oxidative stress';
      case 'pharma-locker':
        return 'Driven by cumulative cabin ionizing dose rate accelerating radiolytic decay';
      case 'bio-scanner-bed':
        return 'Integrated systemic load from mitochondrial exMT release & fluid shift cytokines';
      case 'peptide-bioreactor':
        return 'High metabolic synthesis demand under radiation & unloading stress';
      default:
        return 'Primary orbital environmental & microgravity physiological driver';
    }
  }

  private buildCausalLinks(statusByTerminal: Record<string, AlertLevel>): CausalLink[] {
    const intensityFor = (fromId: string, toId: string, driverVal: number): number => {
      const fromAlert = statusByTerminal[fromId] !== 'NOMINAL' ? 0.35 : 0;
      const toAlert = statusByTerminal[toId] !== 'NOMINAL' ? 0.25 : 0;
      return clamp(driverVal * 0.55 + fromAlert + toAlert, 0.08, 1.0);
    };

    return [
      {
        id: 'rad-to-rehab',
        fromTerminalId: 'radiation-console',
        toTerminalId: 'rehab-terminal',
        driverLabel: 'GCR Muscle Protein Degradation',
        studyId: 'OSD-984',
        activeIntensity: intensityFor('radiation-console', 'rehab-terminal', this.hazards.radiationExposure),
      },
      {
        id: 'rad-to-neural',
        fromTerminalId: 'radiation-console',
        toTerminalId: 'neural-sleep-modulator',
        driverLabel: 'Proton Dopaminergic Deficit',
        studyId: 'OSD-897',
        activeIntensity: intensityFor('radiation-console', 'neural-sleep-modulator', this.hazards.radiationExposure),
      },
      {
        id: 'rad-to-biomarker',
        fromTerminalId: 'radiation-console',
        toTerminalId: 'biomarker-analyzer',
        driverLabel: 'Leukocyte Mobilization',
        studyId: 'OSD-569',
        activeIntensity: intensityFor('radiation-console', 'biomarker-analyzer', this.hazards.radiationExposure),
      },
      {
        id: 'rad-to-circadian',
        fromTerminalId: 'radiation-console',
        toTerminalId: 'circadian-pod',
        driverLabel: 'GCR + Isolation REM Loss',
        studyId: 'OSD-1018',
        activeIntensity: intensityFor('radiation-console', 'circadian-pod', this.hazards.radiationExposure),
      },
      {
        id: 'rad-to-pharma',
        fromTerminalId: 'radiation-console',
        toTerminalId: 'pharma-locker',
        driverLabel: 'Radiolytic Compound Decay',
        studyId: 'OSD-984',
        activeIntensity: intensityFor('radiation-console', 'pharma-locker', this.hazards.radiationExposure),
      },
      {
        id: 'lbnp-to-sans',
        fromTerminalId: 'lbnp-unit',
        toTerminalId: 'sans-ocular-scanner',
        driverLabel: 'Cephalad ICP:IOP Translaminar Shift',
        studyId: 'OSD-816',
        activeIntensity: intensityFor('lbnp-unit', 'sans-ocular-scanner', this.hazards.microgravityFluidShift),
      },
      {
        id: 'lbnp-to-vascular',
        fromTerminalId: 'lbnp-unit',
        toTerminalId: 'vascular-ultrasound',
        driverLabel: 'Plasma Loss & Venous Stasis',
        studyId: 'OSD-656',
        activeIntensity: intensityFor('lbnp-unit', 'vascular-ultrasound', this.hazards.microgravityFluidShift),
      },
      {
        id: 'vascular-to-sans',
        fromTerminalId: 'vascular-ultrasound',
        toTerminalId: 'sans-ocular-scanner',
        driverLabel: 'Optic Disc Edema Cascade',
        studyId: 'OSD-817',
        activeIntensity: intensityFor('vascular-ultrasound', 'sans-ocular-scanner', this.hazards.microgravityFluidShift),
      },
      {
        id: 'bio-to-neural',
        fromTerminalId: 'bio-scanner-bed',
        toTerminalId: 'neural-sleep-modulator',
        driverLabel: 'Mitochondrial exMT Neuroinflammation',
        studyId: 'OSD-941',
        activeIntensity: intensityFor('bio-scanner-bed', 'neural-sleep-modulator', this.hazards.mitochondrialStress),
      },
      {
        id: 'peptide-to-bio',
        fromTerminalId: 'peptide-bioreactor',
        toTerminalId: 'bio-scanner-bed',
        driverLabel: 'Mito-Repair Peptide Stabilization',
        studyId: 'OSD-530',
        activeIntensity: this.countermeasures['peptide-bioreactor'] ? 0.95 : 0.18,
      },
    ];
  }
}
