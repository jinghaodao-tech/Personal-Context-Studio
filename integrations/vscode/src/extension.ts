import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand("pcs.loadContext", async () => {
    const profileId = await vscode.window.showInputBox({ prompt: "PCS Profile ID" });
    if (!profileId) return;
    const baseUrl = vscode.workspace.getConfiguration("pcs").get<string>("baseUrl", "http://127.0.0.1:8300");
    const response = await fetch(`${baseUrl}/v1/context/analysis-snapshot?profileId=${encodeURIComponent(profileId)}`, { headers: { "x-pcs-client-id": process.env.PCS_CLIENT_ID ?? "", authorization: `Bearer ${process.env.PCS_CLIENT_TOKEN ?? ""}` } });
    if (!response.ok) throw new Error(`PCS request failed: ${response.status}`);
    const snapshot = await response.json() as { records: Array<{ title: string; values: Array<{ label: string; value: unknown }> }> };
    const content = snapshot.records.flatMap((record) => [`## ${record.title}`, ...record.values.map((value) => `- ${value.label}: ${JSON.stringify(value.value)}`)]).join("\n");
    const document = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: true });
  });
  context.subscriptions.push(command);
}
export function deactivate() { /* no resources */ }
