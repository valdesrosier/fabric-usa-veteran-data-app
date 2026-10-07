import type { CountySummary } from "../types";

export const SOURCE_LABEL =
  "U.S. Census Bureau · ACS 2020–2024 5-year estimates · Esri Living Atlas";

export const STATE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
};

export const COUNTY_WHERE = `(${Object.keys(STATE_ABBREVIATIONS)
  .map((state) => `GEOID LIKE '${state}%'`)
  .join(" OR ")})`;

export const AGE_FIELDS = [
  { label: "18–34", fields: ["B21001_008E", "B21001_026E"] },
  { label: "35–54", fields: ["B21001_011E", "B21001_029E"] },
  { label: "55–64", fields: ["B21001_014E", "B21001_032E"] },
  { label: "65–74", fields: ["B21001_017E", "B21001_035E"] },
  { label: "75+", fields: ["B21001_020E", "B21001_038E"] },
] as const;

export const COUNT_FIELDS = [
  "B21001_001E",
  "B21001_002E",
  ...AGE_FIELDS.flatMap((band) => [...band.fields]),
];

export const COUNTY_FIELDS = [
  "GEOID",
  "NAME",
  ...COUNT_FIELDS,
  "B21001_calc_pctVetsE",
];

export type Attributes = Record<string, unknown>;

export function estimate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function addEstimates(a: unknown, b: unknown): number | null {
  const first = estimate(a);
  const second = estimate(b);
  return first === null || second === null ? null : first + second;
}

export function countyLabel(name: string, geoid: string): string {
  const state = STATE_ABBREVIATIONS[geoid.slice(0, 2)];
  return state ? `${name}, ${state}` : name;
}

export function summarizeCounty(attributes: Attributes): CountySummary {
  const geoid = typeof attributes.GEOID === "string" ? attributes.GEOID : "";
  const name = typeof attributes.NAME === "string" ? attributes.NAME : "County";
  const percent = estimate(attributes.B21001_calc_pctVetsE);
  return {
    geoid,
    name: countyLabel(name, geoid),
    adultPopulation: estimate(attributes.B21001_001E),
    veterans: estimate(attributes.B21001_002E),
    veteranPercent: percent !== null && percent <= 100 ? percent : null,
    ageBands: AGE_FIELDS.map(({ label, fields }) => ({
      label,
      count: addEstimates(attributes[fields[0]], attributes[fields[1]]),
    })),
    sourceLabel: SOURCE_LABEL,
    isAggregate: false,
  };
}

export function aggregateStatisticDefinitions(objectIdField: string) {
  return [
    {
      statisticType: "count" as const,
      onStatisticField: objectIdField,
      outStatisticFieldName: "county_count",
    },
    ...COUNT_FIELDS.flatMap((field) => [
      {
        statisticType: "sum" as const,
        onStatisticField: field,
        outStatisticFieldName: `sum_${field}`,
      },
      {
        statisticType: "count" as const,
        onStatisticField: field,
        outStatisticFieldName: `count_${field}`,
      },
    ]),
  ];
}

export function summarizeAggregateStatistics(attributes: Attributes): CountySummary {
  const countyCount = estimate(attributes.county_count);
  const totals: Attributes = {};
  for (const field of COUNT_FIELDS) {
    // SQL SUM skips nulls. Do not present a partial sum as a complete U.S. total.
    totals[field] =
      countyCount !== null &&
      countyCount > 0 &&
      estimate(attributes[`count_${field}`]) === countyCount
        ? estimate(attributes[`sum_${field}`])
        : null;
  }
  const summary = summarizeCounty(totals);
  const adults = summary.adultPopulation;
  const veterans = summary.veterans;
  return {
    ...summary,
    geoid: "US",
    name: "U.S. county aggregate",
    isAggregate: true,
    veteranPercent:
      adults !== null && adults > 0 && veterans !== null
        ? (veterans / adults) * 100
        : null,
  };
}

export function hasCountyAttributes(attributes: Attributes): boolean {
  return COUNTY_FIELDS.every((field) =>
    Object.prototype.hasOwnProperty.call(attributes, field),
  );
}

export function isCountyGeoid(value: string): boolean {
  return /^\d{5}$/.test(value) && value.slice(0, 2) in STATE_ABBREVIATIONS;
}
