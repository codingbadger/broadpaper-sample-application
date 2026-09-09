import { ApplicationConfig, provideExperimentalZonelessChangeDetection } from "@angular/core";

/**
 * Zoneless, for two reasons that happen to agree.
 *
 * The forced one: the Forme engine ships a WebAssembly binary, and reaching it
 * through the default browser entry means a bundler-target build that imports
 * its .wasm as an ES module. Angular's builder refuses that in a Zone.js
 * application and says so, pointing here.
 *
 * The one that would apply anyway: the designer runs its own React tree and
 * deliberately does its work outside Angular's zone, so zone-based change
 * detection has nothing useful to observe. This app drives its UI from signals
 * instead, which is what zoneless wants.
 */
export const appConfig: ApplicationConfig = {
  providers: [provideExperimentalZonelessChangeDetection()]
};
