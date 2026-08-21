// Public entry point for external consumers (e.g. MeTheory, as a pinned
// git dependency of the personal-context-studio repo -- see ADR-022). This
// file exists specifically so `tsc` has a single root to compile from
// without also trying to compile files this package doesn't own.

export * from "./types.ts";
export { buildReport, formatReportText } from "./report.ts";
export { checkManifest, manifestChecksPassed } from "./checks/manifest.ts";
export { checkTransport, type TransportCheckOptions } from "./checks/transport.ts";
export { checkAuthenticationAndPermissions, type AuthProbeCredentials, type AuthPermissionCheckOptions } from "./checks/authPermission.ts";
export { checkSnapshotContract, checkImportContract } from "./checks/contract.ts";
