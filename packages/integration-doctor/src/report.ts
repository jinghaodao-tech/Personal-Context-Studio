import type { CheckResult, DiagnosticReport, Severity } from "./types.ts";

const severityRank: Record<Severity, number> = { PASS: 0, INFO: 1, WARNING: 2, ERROR: 3, FATAL: 4 };

export function buildReport(connectorId: string, checks: CheckResult[]): DiagnosticReport {
  const worst = checks.reduce<Severity>((worstSoFar, check) => (severityRank[check.status] > severityRank[worstSoFar] ? check.status : worstSoFar), "PASS");
  const status = worst === "ERROR" || worst === "FATAL" ? (worst === "FATAL" ? "INCOMPATIBLE" : "DEGRADED") : worst === "WARNING" ? "DEGRADED" : "PASS";
  return { connectorId, checks, status };
}

const severityLabel: Record<Severity, string> = { PASS: "[PASS]", INFO: "[INFO]", WARNING: "[WARN]", ERROR: "[ERROR]", FATAL: "[FATAL]" };

export function formatReportText(report: DiagnosticReport): string {
  const lines = [`PCS Integration Doctor`, `Connector: ${report.connectorId}`, ""];
  for (const check of report.checks) lines.push(`${severityLabel[check.status]} ${check.checkId}: ${check.message}`);
  const counts = report.checks.reduce<Record<Severity, number>>((acc, check) => ({ ...acc, [check.status]: (acc[check.status] ?? 0) + 1 }), { PASS: 0, INFO: 0, WARNING: 0, ERROR: 0, FATAL: 0 });
  lines.push("", `Summary: ${counts.PASS} passed, ${counts.WARNING} warning(s), ${counts.ERROR} error(s), ${counts.FATAL} fatal`, `Connector status: ${report.status}`);
  return lines.join("\n");
}
