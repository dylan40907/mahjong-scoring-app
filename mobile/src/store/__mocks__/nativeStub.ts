/**
 * Stands in for a native module the pure-TypeScript test run cannot load.
 *
 * Nothing imports this directly; `jest.config.js` maps the real modules here.
 * The suites that matter test logic sitting above these, and mapping them is
 * cheaper than keeping every file that touches storage out of the tests.
 */
export const getItemAsync = async (): Promise<string | null> => null;
export const setItemAsync = async (): Promise<void> => undefined;
export const deleteItemAsync = async (): Promise<void> => undefined;
export default {};
