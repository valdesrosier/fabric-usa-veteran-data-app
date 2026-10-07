import { describe, expect, it } from "vitest";
import {
  AGE_FIELDS,
  COUNT_FIELDS,
  COUNTY_WHERE,
  addEstimates,
  aggregateStatisticDefinitions,
  estimate,
  isCountyGeoid,
  summarizeAggregateStatistics,
  summarizeCounty,
} from "./data";
import { resolveCountySelection } from "./directory";
import { LatestRequest } from "./latest";

describe("county estimates", () => {
  it("combines the male and female veteran estimate for each age band", () => {
    const attributes: Record<string, unknown> = {
      GEOID: "01001", NAME: "Autauga County",
      B21001_001E: 1000, B21001_002E: 90, B21001_calc_pctVetsE: 9,
    };
    AGE_FIELDS.forEach(({ fields }, index) => {
      attributes[fields[0]] = index + 1;
      attributes[fields[1]] = index + 10;
    });
    const summary = summarizeCounty(attributes);
    expect(summary.name).toBe("Autauga County, AL");
    expect(summary.ageBands.map((band) => band.count)).toEqual([11, 13, 15, 17, 19]);
    expect(summary.veteranPercent).toBe(9);
    expect(summary.sourceLabel).toContain("2020–2024");
    expect(summary.isAggregate).toBe(false);
  });

  it("keeps zero distinct from null, absent, invalid, and suppressed estimates", () => {
    expect(addEstimates(0, 0)).toBe(0);
    expect(addEstimates(null, 3)).toBeNull();
    expect(addEstimates(3, undefined)).toBeNull();
    for (const value of [null, undefined, "", "42", NaN, Infinity, -666666666]) {
      expect(estimate(value)).toBeNull();
    }
    const missing = summarizeCounty({ GEOID: "11001", NAME: "District of Columbia" });
    expect(missing.veterans).toBeNull();
    expect(missing.adultPopulation).toBeNull();
    expect(missing.veteranPercent).toBeNull();
    expect(missing.ageBands.every((band) => band.count === null)).toBe(true);
  });

  it("does not substitute a calculated county share for a missing service estimate", () => {
    const summary = summarizeCounty({
      B21001_001E: 100, B21001_002E: 10, B21001_calc_pctVetsE: null,
    });
    expect(summary.veteranPercent).toBeNull();
  });
});

describe("U.S. county aggregate", () => {
  const statistics = () => Object.fromEntries([
    ["county_count", 2],
    ...COUNT_FIELDS.flatMap((field) => [[`count_${field}`, 2], [`sum_${field}`, 30]]),
    ["sum_B21001_001E", 1000],
    ["sum_B21001_002E", 100],
  ]);

  it("uses server sums, with share calculated from summed populations", () => {
    const summary = summarizeAggregateStatistics(statistics());
    expect(summary.name).toBe("U.S. county aggregate");
    expect(summary.isAggregate).toBe(true);
    expect(summary.veterans).toBe(100);
    expect(summary.adultPopulation).toBe(1000);
    expect(summary.veteranPercent).toBe(10);
    expect(summary.ageBands.map((band) => band.count)).toEqual([60, 60, 60, 60, 60]);
    const definitions = aggregateStatisticDefinitions("OBJECTID");
    expect(definitions).toHaveLength(COUNT_FIELDS.length * 2 + 1);
    expect(definitions.some((definition) => definition.onStatisticField.includes("pct"))).toBe(false);
  });

  it("withholds partial totals and ages rather than turning missing counties into zeros", () => {
    const attributes = statistics();
    attributes.count_B21001_002E = 1;
    attributes.count_B21001_026E = 0;
    const summary = summarizeAggregateStatistics(attributes);
    expect(summary.veterans).toBeNull();
    expect(summary.veteranPercent).toBeNull();
    expect(summary.ageBands[0].count).toBeNull();
    expect(summary.ageBands[1].count).toBe(60);
  });

  it("does not divide by zero or invent totals for an empty service response", () => {
    const attributes = statistics();
    attributes.sum_B21001_001E = 0;
    expect(summarizeAggregateStatistics(attributes).veteranPercent).toBeNull();
    const empty = summarizeAggregateStatistics({ county_count: 0 });
    expect(empty.veterans).toBeNull();
    expect(empty.ageBands.every((band) => band.count === null)).toBe(true);
  });

  it("covers 50 states and DC, never Puerto Rico or other territories", () => {
    expect(COUNTY_WHERE.match(/LIKE/g)).toHaveLength(51);
    expect(COUNTY_WHERE).toContain("GEOID LIKE '11%'");
    expect(COUNTY_WHERE).toContain("GEOID LIKE '02%'");
    expect(COUNTY_WHERE).not.toContain("'72%'");
    expect(isCountyGeoid("72001")).toBe(false);
    expect(isCountyGeoid("66010")).toBe(false);
    expect(isCountyGeoid("01001")).toBe(true);
    expect(isCountyGeoid("01001' OR 1=1")).toBe(false);
  });
});

describe("latest intent wins", () => {
  it("rejects a slow hover as soon as the pointer moves, even before the next hit test", () => {
    const requests = new LatestRequest();
    const slowHover = requests.next();
    const nextPointerMove = requests.next();
    expect(requests.isCurrent(slowHover)).toBe(false);
    expect(requests.isCurrent(nextPointerMove)).toBe(true);
  });

  it("prevents resurrection after pointer leave, reset, or disposal", () => {
    const requests = new LatestRequest();
    const hover = requests.next();
    requests.next();
    expect(requests.isCurrent(hover)).toBe(false);
    const selected = requests.next();
    requests.dispose();
    expect(requests.isCurrent(selected)).toBe(false);
    expect(requests.isCurrent(requests.next())).toBe(false);
  });
});

describe("keyboard county selection", () => {
  const counties = [{ geoid: "01001", name: "Autauga County, AL", label: "Autauga County, AL (01001)" }];
  it("accepts a listed label, case-insensitive full name, or padded FIPS", () => {
    expect(resolveCountySelection(counties[0].label, counties)).toBe("01001");
    expect(resolveCountySelection("autauga county, al", counties)).toBe("01001");
    expect(resolveCountySelection(" 01001 ", [])).toBe("01001");
  });
  it("rejects incomplete, ambiguous, or out-of-scope input", () => {
    expect(resolveCountySelection("Autauga", counties)).toBeNull();
    expect(resolveCountySelection("1001", counties)).toBeNull();
    expect(resolveCountySelection("72001", counties)).toBeNull();
  });
});
