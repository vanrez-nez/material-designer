declare const __APP_VERSION__: string;
declare const __RUNTIME_VERSION__: string;
declare const __COMMIT_HASH__: string;

interface Window {
  // Random splash image chosen by the inline pre-JS script in index.html, reused by SplashScreen.
  __SPLASH_IMG__?: string;
}
