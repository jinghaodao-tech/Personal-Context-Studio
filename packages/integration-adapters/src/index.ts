import { renderTargetWithDetail, normalizeExportTarget, type DetailLevel, type ExportTarget } from "../../export-renderers/src/index.ts";
import { PcsIntegrationClient, type PcsIntegrationClientOptions } from "../../integration-sdk/src/index.ts";

export type EditorAdapterKind = "vscode" | "cursor" | "obsidian";
export type EditorContextAdapterOptions = PcsIntegrationClientOptions & { kind: EditorAdapterKind; target?: ExportTarget; detailLevel?: DetailLevel };

export class EditorContextAdapter {
  readonly kind: EditorAdapterKind;
  private readonly client: PcsIntegrationClient;
  private readonly target: ExportTarget;
  private readonly detailLevel: DetailLevel;
  constructor(options: EditorContextAdapterOptions) {
    this.kind = options.kind;
    this.client = new PcsIntegrationClient(options);
    this.target = normalizeExportTarget(options.target ?? (options.kind === "vscode" ? "agents_md" : options.kind === "cursor" ? "claude_project_instructions" : "markdown_manual"));
    this.detailLevel = options.detailLevel ?? "standard";
  }
  async getContext(profileId: string, range: { from?: string; to?: string; timezone?: string } = {}) {
    const snapshot = await this.client.getAnalysisSnapshot(profileId, range);
    const fields = snapshot.records.flatMap((record) => record.values.map((value) => ({ label: String(value.label), fieldKey: String(value.fieldKey), value: value.value })));
    return { kind: this.kind, profileId, target: this.target, detailLevel: this.detailLevel, content: renderTargetWithDetail(fields, this.target, this.detailLevel), recordCount: snapshot.records.length };
  }
}

export function createEditorAdapter(options: EditorContextAdapterOptions) { return new EditorContextAdapter(options); }
