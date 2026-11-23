import { SeededRng } from "./rng";
import type { CitizenRecord, CompanyInfo } from "./types";

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
  "Alistair",
  "Priya",
  "Gideon",
  "Simone",
  "Ronan",
  "Yuki",
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
  "Harrow",
  "Voss",
  "Delgado",
  "Keller",
  "Nakamura",
  "Thorne",
] as const;

const DEGREES = [
  "B.Sc. Computer Science",
  "M.Sc. Cryptography",
  "B.A. Economics",
  "Ph.D. Bioengineering",
  "B.Eng. Aerospace",
  "M.B.A. Finance",
  "M.Sc. Neural Networks",
  "B.Sc. Cybernetics",
] as const;

const BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;

const MEDICAL_CONDITIONS = [
  "Routine physical — clear",
  "Mild hypertension (managed)",
  "Appendectomy (2004)",
  "Cybernetic ocular implant (2009)",
  "Penicillin allergy",
] as const;

export const COMPANY_NAMES = [
  "Aegis Biotech",
  "Helios Dynamics",
  "Kestrel Financial",
  "Vanguard Micro",
  "Solstice Energy",
  "Obsidian Systems",
  "Meridian Logistics",
  "Cinder Telecom",
  "Arcturus Defense",
  "Novus Pharma",
  "Stratos Aerospace",
  "Pinnacle Media",
  "Darwin Digital",
  "Andromeda Research Corp",
  "Arunmor Corporation",
] as const;

export function generateCitizens(rng: SeededRng, count = 20): Record<string, CitizenRecord> {
  const records: Record<string, CitizenRecord> = {};
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let fullName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    while (usedNames.has(fullName)) {
      fullName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    }
    usedNames.add(fullName);

    const id = `cit_${i + 1}`;
    const hasCrime = rng.chance(0.25);
    const phone = `+44-0${rng.int(100, 999)}-${rng.int(100000, 999999)}`;
    records[id] = {
      id,
      fullName,
      ssn: `${rng.int(100, 999)}-${rng.int(10, 99)}-${rng.int(1000, 9999)}`,
      degree: rng.pick(DEGREES),
      gpa: `${rng.int(2, 3)}.${rng.int(1, 9)}`,
      criminalHistory: hasCrime ? ["Unauthorised systems access (2008)"] : [],
      arrestWarrant: false,
      employment: rng.pick(COMPANY_NAMES.slice(0, 12)),
      deceased: false,
      medicalHistory: [rng.pick(MEDICAL_CONDITIONS)],
      bloodType: rng.pick(BLOOD_TYPES),
      phoneNumber: phone,
      voiceSampleId: `voice_${id}`,
    };
  }

  return records;
}

export function generateCompanies(
  rng: SeededRng,
  citizens: Record<string, CitizenRecord>
): Record<string, CompanyInfo> {
  const companies: Record<string, CompanyInfo> = {};
  const citList = Object.values(citizens);

  for (let i = 0; i < COMPANY_NAMES.length; i++) {
    const name = COMPANY_NAMES[i]!;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const size = rng.int(12, 48);
    const growth = rng.int(-10, 30);
    const alignment = rng.int(-50, 50);

    // 12-month share price history anchored around company size (original company.cpp)
    const shareHistory: number[] = [];
    let price = Math.max(5, Math.round(size * (0.7 + rng.next() * 0.6)));
    for (let m = 0; m < 12; m++) {
      const delta = Math.round(price * ((growth / 100) * 0.08 + (rng.next() - 0.48) * 0.18));
      price = Math.max(2, price + delta);
      shareHistory.push(price);
    }

    companies[id] = {
      id,
      name,
      ceoName: citList[i % citList.length]!.fullName,
      size,
      growth,
      alignment,
      shareHistory,
      currentSharePrice: shareHistory[shareHistory.length - 1]!,
    };
  }

  return companies;
}

export function stepMonthlySharePrices(
  companies: Record<string, CompanyInfo>,
  rng: SeededRng
): void {
  for (const comp of Object.values(companies)) {
    const delta = Math.round(
      comp.currentSharePrice * ((comp.growth / 100) * 0.1 + (rng.next() - 0.48) * 0.22)
    );
    const nextPrice = Math.max(2, comp.currentSharePrice + delta);
    comp.currentSharePrice = nextPrice;
    comp.shareHistory.push(nextPrice);
    if (comp.shareHistory.length > 12) {
      comp.shareHistory.shift();
    }
  }
}
