import { dashboardClientScript } from "./client.ts";
import { dashboardStyles } from "./styles.ts";
export const dashboardHtml = String.raw`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Personal Context Studio</title>
<style>${dashboardStyles}</style></head><body><main class="shell"><header class="top"><div><div class="brand">Personal Context Studio</div><div class="muted">確定済みコンテキストを管理するローカル画面</div></div><div class="actions"><button id="refresh">更新</button><button class="active" id="newEntry">記録する</button></div></header><nav id="tabs" aria-label="管理画面のセクション"></nav><div id="notice" class="notice" role="status" aria-live="polite"></div><section id="metrics" class="grid" aria-label="概要"></section><section id="content" class="panel"></section></main><div id="dialog" class="dialog hidden" role="presentation"></div><script>${dashboardClientScript}</script></body></html>`;
