import { errorMessage, initialOAuthUrl, readOAuthCallback, withoutOAuthCallback } from "./oauth";
import IdentityManager from "@arcgis/core/identity/IdentityManager.js";
import OAuthInfo from "@arcgis/core/identity/OAuthInfo.js";
import Portal from "@arcgis/core/portal/Portal.js";
import { config } from "./config";

const resource = `${config.portalUrl}/sharing`;
const callbackUrl = initialOAuthUrl ?? new URL(window.location.href);
const callback = readOAuthCallback(callbackUrl);

IdentityManager.registerOAuthInfos([
  new OAuthInfo({
    appId: config.clientId,
    portalUrl: config.portalUrl,
    popup: false,
    flowType: "authorization-code",
  }),
]);

export type AuthResult =
  | { status: "signed-in"; portal: Portal }
  | { status: "signed-out"; message?: string };

async function signedInPortal(): Promise<AuthResult> {
  const portal = new Portal({ url: config.portalUrl, authMode: "immediate" });
  await portal.load();
  if (!portal.user) throw new Error("ArcGIS returned no signed-in user. Please try signing in again.");
  return { status: "signed-in", portal };
}

let restoration: Promise<AuthResult> | undefined;
export function restoreSession(): Promise<AuthResult> {
  restoration ??= (async () => {
    try {
      if (callback.error) {
        return {
          status: "signed-out",
          message: `ArcGIS sign-in failed: ${callback.description || callback.error}`,
        };
      }
      try {
        await IdentityManager.checkSignInStatus(resource);
      } catch (error) {
        if (callback.code) {
          return {
            status: "signed-out",
            message: `The ArcGIS callback did not establish a session: ${errorMessage(error)}. Retry sign-in in this browser tab.`,
          };
        }
        const name = typeof error === "object" && error !== null && "name" in error ? error.name : undefined;
        if (name !== "identity-manager:not-authenticated") {
          return { status: "signed-out", message: `Could not check your ArcGIS session: ${errorMessage(error)}` };
        }
        // A missing session is normal. Do not clear the SDK's pending PKCE state.
        return { status: "signed-out" };
      }
      return await signedInPortal();
    } catch (error) {
      return { status: "signed-out", message: errorMessage(error) };
    } finally {
      if (callback.code || callback.error) {
        window.history.replaceState(null, "", withoutOAuthCallback(callbackUrl));
      }
    }
  })();
  return restoration;
}

export async function signIn(): Promise<AuthResult> {
  if (window.top !== window.self) {
    throw new Error("ArcGIS sign-in must run in a full browser tab. Open https://localhost:5173 directly.");
  }
  await IdentityManager.getCredential(resource, { oAuthPopupConfirmation: false });
  return signedInPortal();
}

export function signOut(): void {
  IdentityManager.destroyCredentials();
  window.location.assign(window.location.origin + window.location.pathname);
}
