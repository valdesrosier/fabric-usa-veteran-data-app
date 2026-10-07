import { useEffect, useId, useState, type CSSProperties, type FormEvent } from "react";
import { config } from "../config";
import type { CountySummary } from "../types";
import { SOURCE_LABEL } from "./data";
import { loadCountyDirectory, resolveCountySelection, type CountyOption } from "./directory";
import "./county.css";

export interface CountyPanelProps {
  summary: CountySummary | null;
  loading: boolean;
  onSelectCounty: (geoid: string) => void;
  onReset: () => void;
}

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const formatCount = (value: number | null) => value === null ? "—" : integer.format(value);

export function CountyPanel({ summary, loading, onSelectCounty, onReset }: CountyPanelProps) {
  const id = useId();
  const [directory, setDirectory] = useState<CountyOption[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setDirectoryStatus("loading");
    void loadCountyDirectory(controller.signal)
      .then((counties) => {
        if (controller.signal.aborted) return;
        setDirectory(counties);
        setDirectoryStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setDirectoryStatus("error");
      });
    return () => controller.abort();
  }, [directoryAttempt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const geoid = resolveCountySelection(search, directory);
    if (!geoid) {
      setSearchError("Choose a county from the suggestions, or enter its five-digit FIPS code.");
      return;
    }
    setSearchError("");
    onSelectCounty(geoid);
  };
  const reset = () => {
    setSearch("");
    setSearchError("");
    onReset();
  };
  const hasMissingEstimates = summary !== null && (
    summary.adultPopulation === null ||
    summary.veterans === null ||
    summary.veteranPercent === null ||
    summary.ageBands.some((band) => band.count === null)
  );
  const hasAnyAge = summary?.ageBands.some((band) => band.count !== null) ?? false;

  return (
    <section className="county-panel" aria-labelledby={`${id}-title`} aria-busy={loading}>
      <header className="county-panel__header">
        <h2 id={`${id}-title`}>Veterans, by county</h2>
      </header>

      <form className="county-search" onSubmit={submit}>
        <label htmlFor={`${id}-search`}>Find a county</label>
        <div className="county-search__controls">
          <input
            id={`${id}-search`}
            type="search"
            list={`${id}-counties`}
            value={search}
            placeholder="County, state or FIPS"
            autoComplete="off"
            aria-describedby={`${id}-search-help${searchError ? ` ${id}-search-error` : ""}`}
            aria-invalid={searchError ? true : undefined}
            onChange={(event) => {
              setSearch(event.target.value);
              setSearchError("");
            }}
          />
          <button type="submit" disabled={!search.trim()} aria-label="Show selected county">
            Go <span aria-hidden="true">↗</span>
          </button>
        </div>
        <datalist id={`${id}-counties`}>
          {directory.map((county) => <option key={county.geoid} value={county.label} />)}
        </datalist>
        <p id={`${id}-search-help`} className={directoryStatus === "ready" ? "sr-only" : "county-panel__hint"}>
          {directoryStatus === "loading"
            ? "Loading county names… You can also enter a five-digit FIPS code."
            : directoryStatus === "error"
              ? "County names are unavailable. Enter a five-digit FIPS code."
              : "Type a name, choose a suggestion, then press Enter."}
        </p>
        {directoryStatus === "error" && (
          <button
            className="county-panel__text-button"
            type="button"
            onClick={() => setDirectoryAttempt((attempt) => attempt + 1)}
          >
            Retry county names
          </button>
        )}
        {searchError && <p id={`${id}-search-error`} className="county-panel__error" role="alert">{searchError}</p>}
      </form>

      <div className="county-panel__selection">
        <div>
          <h3 aria-live="polite" aria-atomic="true">{summary?.name ?? (loading ? "Loading county data…" : "County data unavailable")}</h3>
        </div>
        {summary && !summary.isAggregate && (
          <button className="county-panel__reset" type="button" onClick={reset} aria-label="Reset to U.S. county aggregate">
            <span aria-hidden="true">↺</span> U.S.
          </button>
        )}
      </div>

      {summary ? (
        <>
          <dl className="county-stats">
            <div className="county-stats__primary">
              <dt>Veterans (18+)</dt>
              <dd>{formatCount(summary.veterans)}</dd>
            </div>
            <div>
              <dt>Veteran share</dt>
              <dd>{summary.veteranPercent === null ? "—" : `${percent.format(summary.veteranPercent)}%`}</dd>
            </div>
            <div>
              <dt>Adults 18+</dt>
              <dd>{formatCount(summary.adultPopulation)}</dd>
            </div>
          </dl>
          <section className="county-age" aria-labelledby={`${id}-age-heading`}>
            <div className="county-age__heading">
              <h4 id={`${id}-age-heading`}>Veterans by age</h4>
            </div>
            {hasAnyAge ? <AgeChart summary={summary} id={id} /> : (
              <p className="county-panel__empty">Age estimates are not available for this geography.</p>
            )}
          </section>
          {hasMissingEstimates && (
            <p className="county-panel__missing">
              — means an estimate is unavailable, not zero.
              {summary.isAggregate && " A total is withheld if any county is missing that estimate."}
            </p>
          )}
        </>
      ) : (
        <div className={`county-panel__empty${loading ? " county-panel__empty--loading" : ""}`} role="status">
          {loading
            ? "Fetching current county estimates from the Census ACS service…"
            : "The U.S. aggregate could not be loaded. Hover, tap, or search for a county to explore its available estimates."}
        </div>
      )}

      <footer className="county-panel__footer">
        <details className="county-panel__source">
          <summary>ACS 2020–2024 · Data notes</summary>
          <p>{summary?.sourceLabel ?? SOURCE_LABEL}</p>
          <p>Age bands combine male and female estimates.</p>
          <p>
            Estimates, not exact counts. ACS sampling uncertainty is reported as 90% margins of error; margins are not shown here. Small differences may not be statistically meaningful.
          </p>
          {summary?.isAggregate && (
            <p>Aggregate covers the 50 states and Washington, DC; Puerto Rico is excluded. County counts are summed; veteran share uses the summed veteran and civilian adult populations.</p>
          )}
          <a href={config.countyUrl} target="_blank" rel="noreferrer">
            Explore the source data <span aria-hidden="true">↗</span>
          </a>
        </details>
      </footer>
    </section>
  );
}

function AgeChart({ summary, id }: { summary: CountySummary; id: string }) {
  const max = Math.max(0, ...summary.ageBands.map((band) => band.count ?? 0));
  return (
    <svg
      className="county-age__chart"
      viewBox="0 0 268 190"
      role="img"
      aria-labelledby={`${id}-chart-title ${id}-chart-description`}
    >
      <title id={`${id}-chart-title`}>Veteran age distribution: {summary.name}</title>
      <desc id={`${id}-chart-description`}>
        {summary.ageBands.map((band) => `${band.label} years: ${band.count === null ? "unavailable" : integer.format(band.count)} veterans`).join(". ")}.
        {" "}Bar lengths compare counts across age groups, not percentages.
      </desc>
      {summary.ageBands.map((band, index) => {
        const y = index * 37 + 11;
        return (
          <g key={band.label} aria-hidden="true">
            <text className="county-age__label" x="0" y={y + 13}>{band.label}</text>
            <rect className="county-age__track" x="49" y={y} width="131" height="19" rx="3" />
            <rect
              className={`county-age__bar${index === 4 ? " county-age__bar--accent" : ""}`}
              x="49"
              y={y}
              width="131"
              style={{ "--county-bar-scale": band.count === null || max === 0 ? 0 : band.count / max } as CSSProperties}
              height="19"
              rx="3"
            />
            <text className="county-age__count" x="268" y={y + 13} textAnchor="end">{formatCount(band.count)}</text>
          </g>
        );
      })}
    </svg>
  );
}
