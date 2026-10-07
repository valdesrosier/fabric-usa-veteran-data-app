# Veteran Atlas

A React and TypeScript web app for exploring U.S. veteran data, county
demographics, and geodemographic similarity with the ArcGIS Maps SDK for
JavaScript and ArcGIS AI Components.

Run and develop the application directly from the repository root.
See the [application guide](./docs/application-guide.md) for detailed
configuration, data sources, assistant behavior, and verification instructions.

## Features

- **ArcGIS Online sign-in** using authorization-code/PKCE authentication.
- **Veteran map** loaded from the supplied web map, with county boundaries behind
  the veteran aggregate hex bins. Veteran popups show the actual `DESCRIPTION`
  and `COUNT` fields.
- **County insights** with responsive hover highlighting, veteran statistics,
  an age-distribution chart, and county search.
- **AI assistants** for navigation, data exploration, help, organization and
  Living Atlas layer discovery, geodemographic similarity, county demographic
  context, commonalities, and bookmarks.
- **Geodemographic hex comparison** using existing embedding vectors. Selection
  is violet, matches are teal, and county hover is blue. Matches persist while
  you select again; **Clear comparison** removes them independently.
- **Responsive layout** with map, county, and assistant tabs on smaller screens.

## Quick start

Requires **Node.js 22.12+**, npm, an internet connection, and an ArcGIS Online
organizational account with access to the map and its layers. AI assistants also
require the appropriate organization settings, privileges, and beta access.

```powershell
git clone https://github.com/valdesrosier/fabric-usa-veteran-data-app.git
Set-Location .\fabric-usa-veteran-data-app
npm ci
npm run dev
```

Open **https://localhost:5173/** in a full browser tab and accept the local
development certificate warning if prompted. Then sign in with ArcGIS Online.

**Use HTTPS, not HTTP.** The supplied OAuth client accepts the HTTPS localhost
redirect and rejects the HTTP equivalent. Port 5173 is fixed, and sign-in must
run outside an embedded preview.

## Using the map

Hover over a county to update its statistics and chart; move off to restore the
U.S. aggregate. Click a veteran bin outside selection mode to read its Description
and Count.

To compare locations, click **Select hexes**, select up to 20 small
**USA Geodemographic Embeddings 2026** hexes, and ask:

> Find geodemographic hexes similar to my selection with a threshold of 0.8.

Similarity compares existing 256-dimensional embedding vectors within the map
extent. It does **not** aggregate smaller cells into the larger veteran bins.
The current limit is 5,000 candidate hexes; zoom in if the extent exceeds it.
Popups are suppressed while selection mode is active.

Other prompts to try:

- "Find veteran layers in Living Atlas."
- "Find layers in my organization."
- "Describe the demographics around my selected hexes."
- "What do my selected areas have in common?"

## Data and interpretation

| Data | Purpose |
| --- | --- |
| [Veteran Aggregated Map](https://www.arcgis.com/home/item.html?id=dab72f4380b94f78836b4f68c54e66a5) | Authored map and veteran aggregate bins |
| [ACS Veteran Status (Latest)](https://www.arcgis.com/home/item.html?id=735efa4ad15240269a5c089b5250bda7) | County estimates; configured vintage is ACS 2020-2024 |
| [USA Geodemographic Embeddings 2026](https://www.arcgis.com/home/item.html?id=6637a530b840446285a4383627a13f1f) | Small-hex similarity vectors |

County statistics are **county estimates**, not hex-level measurements.
Geodemographic similarity is not similarity in veteran-procedure counts.
Layer additions and comparison results are session-only: the app does not save
changes to hosted features or the source web map, and it does not call
GeoEnrichment.

## Project structure

```text
src/
  agents/              AI tools, layer discovery, and similarity comparison
  county/              County data queries, chart, and explorer panel
  App.tsx              Sign-in and application shell
  Workspace.tsx        Map, county panel, and assistant integration
  config.ts            ArcGIS portal, layer, and comparison settings
  selection.ts         Geodemographic hex selection
  veteran-popup.ts     Veteran Description and Count popup
scripts/               User-assisted browser and assistant diagnostics
tests/                 Playwright browser tests
docs/
  application-guide.md Detailed usage, limitations, and data references
index.html             Vite entry page
package.json           Dependencies and development commands
vite.config.ts         HTTPS localhost server and production build
```

Unit tests are colocated with the modules they cover under `src/`.

## Development

From the repository root:

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The stack uses React 19, ArcGIS Maps SDK and AI Components 5.1.26, Calcite 5.1.2,
TypeScript, and Vite. Application settings are in
[`src/config.ts`](./src/config.ts).

For authentication details, assistant limitations, live verification, and source
references, read the [application guide](./docs/application-guide.md).
