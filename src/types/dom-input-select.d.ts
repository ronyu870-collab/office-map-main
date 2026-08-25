export {};

declare global {
  interface HTMLElement {
    /**
     * Used only after an `instanceof HTMLInputElement` runtime guard in the
     * quarterly keyboard-navigation path. This declaration lets TypeScript
     * retain the DOM method across indexed element access.
     */
    select(): void;
  }
}
