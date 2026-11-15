import fs from 'node:fs';
import path from 'node:path';
import type { OsdrStudyRaw } from '../types/medbay.ts';

const OSDR_FILENAMES = [
  'OSD-575_SpaceX_Inspiration4_Serum_Metabolic_Cytokine.json',
  'OSD-656_SpaceX_Inspiration4_Urine_Inflammation_Panel.json',
  'OSD-569_SpaceX_Inspiration4_Whole_Blood_CBC.json',
  'OSD-816_SANS_Human_Retina_Translaminar_System.json',
  'OSD-817_SANS_Optic_Nerve_Histology_Microscopy.json',
  'OSD-530_JAXA_ISS_Astronaut_CellFree_RNA_Liquid_Biopsy.json',
  'OSD-941_ISS_Human_Brain_Organoids_Neural_Programs.json',
  'OSD-984_GCR_Radiation_Hindlimb_Unloading_Skeletal_Muscle.json',
  'OSD-1018_Social_Isolation_Space_Radiation_Behavior_Motor.json',
  'OSD-897_Proton_Radiation_Psychomotor_Vigilance_Cognition.json',
];

export function loadOsdrStudies(): Record<string, OsdrStudyRaw> {
  const baseDir = path.resolve(process.cwd(), 'src', 'data', 'osdr');
  const studies: Record<string, OsdrStudyRaw> = {};

  for (const filename of OSDR_FILENAMES) {
    const filePath = path.join(baseDir, filename);
    const rawText = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(rawText) as OsdrStudyRaw;
    studies[parsed.study_id] = parsed;
  }

  return studies;
}
