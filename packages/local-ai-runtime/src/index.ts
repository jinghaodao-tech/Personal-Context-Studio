import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

export type RuntimeState = "stopped" | "starting" | "ready" | "busy" | "stopping" | "failed";
export type DetectedRuntime = { id: string; displayName: string; installed: boolean; running: boolean; baseUrl: string; detectedModels: string[]; canAutoStart: boolean };

export function isLoopbackUrl(value: string): boolean {
  try { const url = new URL(value); return ["127.0.0.1", "localhost", "::1"].includes(url.hostname); } catch { return false; }
}

export async function detectOllama(): Promise<DetectedRuntime> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    const payload = await response.json() as { models?: Array<{ name?: string }> };
    return { id: "ollama", displayName: "Ollama", installed: true, running: response.ok, baseUrl: "http://127.0.0.1:11434", detectedModels: payload.models?.map((model) => String(model.name ?? "")).filter(Boolean) ?? [], canAutoStart: false };
  } catch { return { id: "ollama", displayName: "Ollama", installed: false, running: false, baseUrl: "http://127.0.0.1:11434", detectedModels: [], canAutoStart: false }; }
}

export async function detectOpenAiCompatible(baseUrl = "http://127.0.0.1:1234/v1"): Promise<DetectedRuntime> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/v1\/?$/, "")}/models`);
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    return { id: "openai-compatible-local", displayName: "OpenAI-compatible local", installed: true, running: response.ok, baseUrl, detectedModels: payload.data?.map((model) => String(model.id ?? "")).filter(Boolean) ?? [], canAutoStart: false };
  } catch { return { id: "openai-compatible-local", displayName: "OpenAI-compatible local", installed: false, running: false, baseUrl, detectedModels: [], canAutoStart: false }; }
}

export class RuntimeManager {
  private child?: ChildProcess;
  private idleTimer?: NodeJS.Timeout;
  private operations = 0;
  private readonly config: { executablePath?: string; arguments?: string[]; workingDirectory?: string; idleTimeoutMinutes?: number };
  state: RuntimeState = "stopped";

  constructor(config: { executablePath?: string; arguments?: string[]; workingDirectory?: string; idleTimeoutMinutes?: number } = {}) { this.config = config; }

  beginOperation(): () => void {
    this.operations += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.state === "ready") this.state = "busy";
    return () => {
      this.operations = Math.max(0, this.operations - 1);
      if (this.operations === 0 && this.state === "busy") { this.state = "ready"; this.armIdleTimer(); }
    };
  }

  async startWithRetry(retries = 1): Promise<void> {
    let failure: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try { return await this.start(); } catch (error) { failure = error; await this.stop(); }
    }
    throw failure;
  }

  async start(): Promise<void> {
    if (this.state === "ready" || this.state === "busy") return;
    if (!this.config.executablePath || !existsSync(this.config.executablePath)) { this.state = "failed"; throw new Error("runtime_executable_unavailable"); }
    this.state = "starting";
    this.child = spawn(this.config.executablePath, this.config.arguments ?? [], { cwd: this.config.workingDirectory, shell: false, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { this.child?.once("spawn", resolve); this.child?.once("error", reject); });
    this.state = this.operations ? "busy" : "ready";
    this.armIdleTimer();
  }

  async stop(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.child) { this.state = "stopping"; this.child.kill(); this.child = undefined; }
    this.operations = 0;
    this.state = "stopped";
  }

  private armIdleTimer() {
    if (this.operations || this.idleTimer) return;
    const minutes = this.config.idleTimeoutMinutes ?? 15;
    if (minutes <= 0) return;
    this.idleTimer = setTimeout(() => { if (this.operations === 0) void this.stop(); }, minutes * 60_000);
  }
}
