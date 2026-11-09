// The shape of everything the app saves. It all lives in one object in the person's own browser.

export const SCHEMA_VERSION = 1;

export const STATUSES = ["Interested", "Applied", "Screening", "Interviewing", "Offer", "Closed"] as const;
export type Status = (typeof STATUSES)[number];
export const BONUS_OPTIONS = ["Unknown", "Mentioned", "Not mentioned"] as const;

export interface ExperienceClaim {
  /** What the experience is in, as written on the resume, e.g. "product leadership". */
  area: string;
  /** The number of years you want to claim, e.g. 8 for "8+ years in product leadership". */
  years: number;
}

export interface Settings {
  name: string;
  location: string;
  /** Words or phrases every resume version should include, such as a current employer. */
  mustInclude: string[];
  experienceClaims: ExperienceClaim[];
  /** Team sizes that appear on your resume. Any other "N direct reports" gets flagged. */
  teamSizes: number[];
  toneWords: string[];
  flagDashes: boolean;
  /** Flag roles whose posted base pay tops out under this amount. 0 turns it off. */
  payFloor: number;
  workSetups: string[];
  /** Work setups that get a warning, such as ones that need a move. */
  flaggedSetups: string[];
  relationships: string[];
}

export interface Version {
  id: string;
  n: number;
  label: string;
  note: string;
  content: string;
  createdAt: string;
}

export interface Application {
  id: string;
  company: string;
  role: string;
  status: Status;
  appliedOn: string;
  versionId: string;
  setup: string;
  base: string;
  bonus: string;
  nextStep: string;
  nextDate: string;
  contact: string;
  url: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Share {
  id: string;
  versionId: string;
  date: string;
  note: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string;
  title: string;
  relationship: string;
  reach: string;
  followUp: string;
  notes: string;
  shares: Share[];
  createdAt: string;
  updatedAt: string;
}

export interface Headline {
  id: string;
  n: number;
  label: string;
  text: string;
  note: string;
  createdAt: string;
}

export interface Library {
  schema: number;
  settings: Settings;
  versions: Version[];
  currentVersion: string | null;
  applications: Application[];
  contacts: Contact[];
  headlines: Headline[];
  currentHeadline: string | null;
  /** When the person last saved a backup file, so the app can remind them. */
  lastBackupAt: string | null;
}

export function defaultSettings(): Settings {
  return {
    name: "",
    location: "",
    mustInclude: [],
    experienceClaims: [],
    teamSizes: [],
    toneWords: ["excited", "thrilled", "passionate", "energized"],
    flagDashes: true,
    payFloor: 0,
    workSetups: ["Remote", "Hybrid", "On-site", "Requires relocation"],
    flaggedSetups: ["Requires relocation"],
    relationships: ["Former colleague", "Alum", "Recruiter", "Mentor", "Friend"],
  };
}

export function emptyLibrary(): Library {
  return {
    schema: SCHEMA_VERSION,
    settings: defaultSettings(),
    versions: [],
    currentVersion: null,
    applications: [],
    contacts: [],
    headlines: [],
    currentHeadline: null,
    lastBackupAt: null,
  };
}
