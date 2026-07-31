const { Plugin, Notice, requestUrl } = require("obsidian");
module.exports = class PersonalContextStudioPlugin extends Plugin {
  async onload() {
    this.addCommand({ id: "load-pcs-context", name: "Load PCS context profile", callback: async () => {
      const profileId = window.prompt("PCS Profile ID"); if (!profileId) return;
      const result = await requestUrl({ url: `http://127.0.0.1:8300/v1/context/analysis-snapshot?profileId=${encodeURIComponent(profileId)}`, headers: { "x-pcs-client-id": window.localStorage.getItem("pcs-client-id") || "", authorization: `Bearer ${window.localStorage.getItem("pcs-client-token") || ""}` } });
      const text = result.json.records.flatMap((record) => [`## ${record.title}`, ...record.values.map((value) => `- ${value.label}: ${JSON.stringify(value.value)}`)]).join("\n");
      const leaf = this.app.workspace.getLeaf(true); await leaf.openFile(await this.app.vault.create("PCS-context-preview.md", text)); new Notice("PCS context preview opened");
    }});
  }
};
