import { SeededRng } from "./rng";
import type { CitizenRecord } from "./types";

const FIRST_NAMES = [
  "Elena",
  "Marcus",
  "Sora",
  "Viktor",
  "Nadia",
  "Devon",
  "Clara",
  "Julian",
  "Tessa",
  "Kenji",
  "Maren",
  "Hector",
] as const;

const LAST_NAMES = [
  "Vance",
  "Kowalski",
  "Tanaka",
  "Mercer",
  "Okafor",
  "Lindqvist",
  "Reyes",
  "Chen",
  "Sterling",
  "Volkov",
  "Patel",
  "Sinclair",
] as const;

const DEGREES = [
  "B.Sc. Computer Science",
  "M.Sc. Cryptography",
  "B.A. Economics",
  "Ph.D. Bioengineering",
  "B.Eng. Aerospace",
  "M.B.A. Finance",
] as const;

const EMPLOYERS = [
  "Aegis Biotech",
  "Helios Dynamics",
  "Kestrel Financial",
  "Vanguard Micro",
  "Obsidian Systems",
  "Arcturus Defense",
] as const;

export function generateCitizens(rng: SeededRng, count = 12): Record<string, CitizenRecord> {
  const records: Record<string, CitizenRecord> = {};
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let fullName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    while (usedNames.has(fullName)) {
      fullName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    }
    usedNames.add(fullName);

    const id = `cit_${i + 1}`;
    const hasCrime = rng.chance(0.35);
    records[id] = {
      id,
      fullName,
      ssn: `${rng.int(100, 999)}-${rng.int(10, 99)}-${rng.int(1000, 9999)}`,
      degree: rng.pick(DEGREES),
      gpa: `${rng.int(2, 3)}.${rng.int(1, 9)}`,
      criminalHistory: hasCrime ? ["Unauthorized system intrusion (2008)"] : [],
      arrestWarrant: false,
      employment: rng.pick(EMPLOYERS),
      deceased: false,
    };
  }

  return records;
}
