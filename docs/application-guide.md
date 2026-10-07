# Veteran Atlas application guide

React + TypeScript county explorer using ArcGIS Maps SDK for JavaScript 5.1.26,
AI Components 5.1.26 and Calcite 5.1.2. Run commands from the repository root;
see the [project README](../README.md) for the quick start and directory layout.

## Run

Requires Node.js 22.12+ (verified with Node 24).

```powershell
npm ci
npm run dev
```

Open **https://localhost:5173/** in a full browser tab. Accept the local
development certificate warning if prompted. The server uses a strict port:
it will not silently move to another port if 5173 is occupied.

The supplied client ID rejects `http://localhost:5173/` and accepts
`https://localhost:5173/`; HTTPS was confirmed by an OAuth authorize probe and
approved for this application. ArcGIS does not support showing its sign-in
page inside an iframe; embedded previews show an external-tab link.

Authentication uses ArcGIS IdentityManager's authorization-code/PKCE redirect
flow. No application secret or API key is needed. OAuth state is not destroyed
on a normal signed-out check; credentials are cleared only by **Sign out**.
The React sign-in screen is unmounted when the authenticated portal loads.

## Explore

- Loads web map `dab72f4380b94f78836b4f68c54e66a5` without saving changes to it.
- Adds the **County** sublayer of Living Atlas **ACS Veteran Status (Latest)**,
  item `735efa4ad15240269a5c089b5250bda7`. Its current vintage is ACS 2020–2024.
  County boundaries are inserted below the veteran-bin layer (or its parent
  group), preserving the authored background layers underneath.
- Hover a county to highlight it and update veteran count, share of civilian
  adults, adult population and veteran-by-age bars. Move off to restore the
  aggregate for the 50 states and Washington, DC (Puerto Rico excluded).
- Hover outlines are blue; selected USA geodemographic hexes and the selection
  toggle are violet; comparison matches are teal.
  Source attribution and statistical caveats are available under **Data notes**.
- County search also works by name or five-digit FIPS code for keyboard users;
  tap a county on touch devices. Missing estimates stay missing, not zero.
- **Select hexes** enables click-to-toggle selection of up to 20 smaller
  **USA Geodemographic Embeddings 2026** hexes. Only those hexes can be selected
  for comparison; the larger veteran aggregate bins remain a display layer.
  Selection remains separate from county hover. All click-triggered map popups
  are disabled during selection, and any open popup closes on entry. Previous
  popup behavior is restored when selection mode ends.
- Veteran-bin popups display the feature's actual `DESCRIPTION` and `COUNT`
  fields, labeled **Description** and **Count**, plus its hex ID. Count is only
  formatted for readability, not recalculated. Missing values are labeled unavailable.
- On small screens, switch between **Map**, **County**, and **Assistant** tabs.

### Assistants

The assistant includes the SDK's Navigation, Data Exploration and Help agents.
Custom agents cover organization-layer search/add, Living Atlas search/add,
geodemographic similarity, demographic summaries, commonalities and bookmarks.
The reference app's MCP integration is intentionally excluded. A Knowledge
agent is not registered because this map has no knowledge graph.

Try:

- "Find veteran layers in Living Atlas", then ask to add one of the results.
- "Find layers in my organization."
- "Find geodemographic hexes similar to my selection with a threshold of 0.8."
- "Describe the demographics around my selected hexagons."
- "What do my selected areas have in common?"
- "List my map bookmarks."

Layer additions are session-only, deduplicated and permission-aware. Catalog
search is paginated. Private/subscriber layers remain subject to your ArcGIS
permissions. Unsupported item types return an explicit error.

The assistant initializes against the original web map's saved
`embeddings-v01.json` resource **before** ACS is added. SDK 5.1's built-in
metadata registry does not dynamically incorporate session-added layers.
Built-in data exploration therefore covers the authored map layers; the custom
demographic tools query the added ACS layer directly. Initialization waits for
`arcgisReady` and surfaces errors instead of treating registration as readiness.

### Geodemographic hex similarity

Select the small USA geodemographic hexes, then ask the assistant to find similar
hexes. Similarity compares their existing 256 `emb_*` values directly, using
cosine similarity against the arithmetic mean of the selected vectors (default
threshold 0.8). Matching small hexes are highlighted in teal; selected hexes are
excluded. No veteran-bin aggregation, polygon intersections, or regional profile
cache is used.

Candidates intersect the map extent captured when the request begins; panning
during a request does not change its scope. Queries respect the source layer's
definition filter and service transfer limits. The existing 5,000-candidate
extent limit remains, but there is no underlying-cell aggregation limit.
Invalid selected vectors stop the request; invalid candidates are explicitly
reported as exclusions. Embedding scores are not population estimates or
veteran-procedure counts.

Progress and **Cancel** appear only while working. Changing or clearing the
selection cancels pending work but preserves the last completed matches.
The **Last comparison** summary shows that run's match count, reference selection
count, and threshold, independently of the current selection. **Clear comparison**
removes those matches without clearing the selection. A successful new comparison
replaces the previous matches (including a zero-match result); a failed or
cancelled request leaves them intact. Signing out clears the workspace.
A five-minute timeout prevents indefinite requests; no truncated comparisons
are returned. Only matching hex geometries are downloaded for highlighting.

Demographics describe the containing **ACS counties**, not inferred hexagon
totals. Commonality comparisons deduplicate counties. No live GeoEnrichment
requests or edits to hosted features are performed.

## Access requirements

Use a named ArcGIS Online organizational account with access to the web map,
its layers and the AI-assistant privilege. The organization must enable AI
assistants and permit beta capabilities. Public and trial accounts are not
supported by AI Components. These services require an internet connection.

AI Components are beta. Confirm answers against source data, especially
statistical comparisons. ACS estimates have sampling uncertainty; the panel
does not display margins of error. Esri's beta FAQ currently states there is
no charge for AI-component interactions during beta; other ArcGIS service
entitlements and future pricing are separate.

## Verification

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The browser suite checks the real signed-out UI, PKCE redirect, callback errors
and mobile layout. It does not fake authentication.

For user-assisted live verification, leave `npm run dev` running, then:

```powershell
node .\scripts\live-browser.mjs
```

Sign in in the opened Chromium window. In another terminal at the repository root:

```powershell
node .\scripts\verify-live.mjs
```

This checks the actual signed-in gate, loaded map, registered agents, hover
latency, exact live county values and reset behavior. Agent registration alone
does **not** prove successful LLM conversations: those require live prompts.
The temporary browser closes after 30 minutes or when its process is stopped.
Its local connection metadata, screenshots and reports are ignored in
`test-results/`. Credentials and storage state are never exported by these
scripts.

The user-facing verification window uses the browser's actual window size
(`viewport: null`), rather than a fixed emulated viewport.

To check a live assistant response using the same signed-in browser:

```powershell
node .\scripts\check-assistant.mjs
```

This asks for map bookmarks by default; `--help-prompt` requests Help instead.
It requires the live browser above and does not bypass sign-in.

## Sources

- [SDK version matrix](https://developers.arcgis.com/javascript/latest/version-matrix/)
- [AI components](https://developers.arcgis.com/javascript/latest/references/ai-components/)
- [Custom agents](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-custom-agents/)
- [AI access and beta pricing](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-faq/)
- [ACS Veteran Status item](https://www.arcgis.com/home/item.html?id=735efa4ad15240269a5c089b5250bda7)
- [Reference application's behavior](https://github.com/valdesrosier/arcgis-aicomponents-hurricanerisk-demoapp)
