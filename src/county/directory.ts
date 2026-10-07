import { config } from "../config";
import { COUNTY_WHERE, countyLabel, isCountyGeoid } from "./data";

export interface CountyOption {
  geoid: string;
  name: string;
  label: string;
}

let cachedDirectory: CountyOption[] | null = null;

export async function loadCountyDirectory(signal: AbortSignal): Promise<CountyOption[]> {
  if (cachedDirectory) return cachedDirectory;
  const counties: CountyOption[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const parameters = new URLSearchParams({
      f: "json",
      where: COUNTY_WHERE,
      outFields: "GEOID,NAME",
      returnGeometry: "false",
      orderByFields: "NAME ASC,GEOID ASC",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    const response = await fetch(`${config.countyUrl}/query?${parameters}`, { signal });
    if (!response.ok) throw new Error("The county directory could not be loaded.");
    const data = await response.json() as {
      error?: { message?: string };
      exceededTransferLimit?: boolean;
      features?: { attributes: { GEOID?: string; NAME?: string } }[];
    };
    if (data.error || !Array.isArray(data.features)) {
      throw new Error("The county directory is unavailable. Enter a five-digit county FIPS code instead.");
    }
    for (const feature of data.features) {
      const { GEOID: geoid, NAME: name } = feature.attributes;
      if (typeof geoid === "string" && isCountyGeoid(geoid) && typeof name === "string") {
        const fullName = countyLabel(name, geoid);
        counties.push({ geoid, name: fullName, label: `${fullName} (${geoid})` });
      }
    }
    if (!data.exceededTransferLimit || data.features.length === 0) break;
  }
  if (counties.length === 0) throw new Error("No counties were returned by the directory.");
  signal.throwIfAborted();
  cachedDirectory = counties;
  return counties;
}

export function resolveCountySelection(value: string, counties: CountyOption[]): string | null {
  const trimmed = value.trim();
  if (isCountyGeoid(trimmed)) return trimmed;
  const normalized = trimmed.toLocaleLowerCase();
  const matches = counties.filter((county) =>
    county.label.toLocaleLowerCase() === normalized ||
    county.name.toLocaleLowerCase() === normalized,
  );
  return matches.length === 1 ? matches[0].geoid : null;
}
