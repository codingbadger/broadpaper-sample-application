import { ApplicationConfig, provideExperimentalZonelessChangeDetection } from "@angular/core";

/**
 * Zoneless, because the designer is.
 *
 * It runs its own React tree and deliberately does its work outside Angular's
 * zone, so zone-based change detection has nothing useful to observe. This app
 * drives its UI from signals instead, which is what zoneless wants.
 *
 * It used to be forced as well: reaching the Forme engine through
 * `@broadpaper/forme` pulled in a bundler-target WebAssembly build whose
 * `.wasm` ES module import Angular's builder refuses under Zone.js. That was
 * fixed in the SDK — the package now has a browser entry that instantiates the
 * engine explicitly — so this is a choice again. `"polyfills": ["zone.js"]`
 * builds fine if you would rather.
 */
export const appConfig: ApplicationConfig = {
  providers: [provideExperimentalZonelessChangeDetection()]
};
