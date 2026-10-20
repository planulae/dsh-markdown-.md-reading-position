/**
 * Host half of dsh-doc-progress.
 *
 * The reading-position memory lives entirely in the browser half
 * (`exports["./client"]`). This host entry exists so the package can be a
 * profile bundle layer and so the client module graph discovers `dsh.client`.
 *
 * @module dsh-doc-progress
 */

/** No host services are required. */
export const inject = []

/**
 * Intentionally empty: the browser half installs the scroll observer.
 * @returns Nothing.
 */
export function apply() {}
