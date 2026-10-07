import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import type Portal from "@arcgis/core/portal/Portal.js";
import { restoreSession, signIn, signOut } from "./auth";
import { errorMessage } from "./oauth";

const Workspace = lazy(() => import("./Workspace"));

class WorkspaceBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: errorMessage(error) };
  }
  render() {
    if (this.state.error) {
      return <main className="startup-error" role="alert">
        <h1>The workspace could not start</h1>
        <p>{this.state.error}</p>
        <button onClick={() => window.location.reload()}>Reload workspace</button>
      </main>;
    }
    return this.props.children;
  }
}

export default function App() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    restoreSession().then((result) => {
      if (!active) return;
      if (result.status === "signed-in") setPortal(result.portal);
      else setError(result.message);
      setChecking(false);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(errorMessage(reason));
      setChecking(false);
    });
    return () => { active = false; };
  }, []);

  async function handleSignIn() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await signIn();
      if (result.status === "signed-in") setPortal(result.portal);
      else setError(result.message);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  if (portal) {
    return <WorkspaceBoundary>
      <Suspense fallback={<main className="workspace-loading" role="status">Opening your map and assistants...</main>}>
        <Workspace portal={portal} onSignOut={signOut} />
      </Suspense>
    </WorkspaceBoundary>;
  }

  return <main className="sign-in-page" data-testid="sign-in-gate">
    <section className="welcome">
      <div className="brand"><span className="brand-mark" aria-hidden="true">VA</span> VETERAN ATLAS</div>
      <div className="welcome-copy">
        <h1>Explore veteran<br />communities.</h1>
      </div>
    </section>
    <section className="sign-in-card" aria-labelledby="sign-in-heading">
      <div className="contour-art" aria-hidden="true">
        <svg viewBox="0 0 300 170">
          {[0, 1, 2, 3, 4, 5].map((i) => <path key={i}
            d={`M ${15 + i * 13} 155 C ${-10 + i * 13} ${90 - i * 5}, ${100 + i * 5} ${120 - i * 11}, ${105 + i * 8} ${65 - i * 8} S ${190 + i * 10} ${-5 + i * 7}, ${290 - i * 2} ${30 + i * 10}`} />)}
          <circle cx="162" cy="70" r="7" /><circle cx="162" cy="70" r="18" className="map-pulse" />
        </svg>
      </div>
      <h2 id="sign-in-heading">Sign in</h2>
      <p>Open your map and AI assistants.</p>
      {error && <div role="alert" className="auth-error">{error}</div>}
      <button className="primary-button sign-in-button" onClick={() => void handleSignIn()}
        disabled={checking || busy}>
        {checking ? "Checking your session..." : busy ? "Opening ArcGIS..." : "Sign in with ArcGIS"}
        {!checking && !busy && <span aria-hidden="true">↗</span>}
      </button>
      <p className="sign-in-note">Requires an ArcGIS organization with AI enabled.</p>
      {window.top !== window.self && <a className="external-link" href="https://localhost:5173/" target="_blank" rel="noreferrer">
        Open in a full browser tab
      </a>}
    </section>
  </main>;
}
