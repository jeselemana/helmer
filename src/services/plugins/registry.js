import { hasGeminiConfiguration, hasOpenAIConfiguration } from "../ai/config.js";
import { schemasFor, sectionSchema, sheetSchema, slideSchema } from "../artifacts/schemas.js";

export class PluginRegistry {
  constructor() { this.plugins = new Map(); }
  register(plugin) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(plugin.id) || this.plugins.has(plugin.id) || typeof plugin.execute !== "function" || typeof plugin.availability !== "function" ||
      ["name", "icon", "description"].some(key => typeof plugin[key] !== "string" || !plugin[key].trim()) ||
      ["capabilities", "acceptedInputs", "outputTypes", "permissionRequirements"].some(key => !Array.isArray(plugin[key]) || plugin[key].some(value => typeof value !== "string" || !value.trim())) ||
      !plugin.capabilities.length || !plugin.outputTypes.length) throw new Error("Invalid plugin registration");
    this.plugins.set(plugin.id, Object.freeze(plugin)); return this;
  }
  get(id) {
    if (id === "research") return this.plugins.get("deep-research") || this.plugins.get("research");
    return this.plugins.get(id);
  }
  list() {
    return [...this.plugins.values()].map(({ execute, schemas, intentPattern, referencePattern, ...metadata }) => ({ ...metadata, availability: metadata.availability(), status: metadata.availability() ? "available" : "unavailable" }));
  }
  detect(prompt) { return [...this.plugins.values()].find(plugin => plugin.intentPattern?.test(prompt)); }
  reference(prompt) { return [...this.plugins.values()].find(plugin => plugin.referencePattern?.test(prompt)); }
}

export function createPluginRegistry() {
  const registry = new PluginRegistry();
  const available = () => hasGeminiConfiguration() || hasOpenAIConfiguration();
  const definitions = [
    ["word", "Word", "document", "sənəd yarat", "Create a document", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sectionSchema, 60, /(?:\bword\b|\bdocx\b|word sənədi)/i],
    ["excel", "Excel", "spreadsheet", "spreadsheet, hesablama və analiz yarat", "Create spreadsheets, calculations and analysis", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sheetSchema, 20, /(?:\bexcel\b|\bxlsx\b|spreadsheet|elektron cədvəl)/i],
    ["powerpoint", "PowerPoint", "presentation", "təqdimat yarat", "Create a presentation", "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", slideSchema, 50, /(?:\bpowerpoint\b|\bpptx\b|(?:təqdimat|presentation|slide deck).*(?:hazırla|yarat|create|make)|(?:create|make|prepare).*(?:presentation|slide deck))/i],
    ["pdf", "PDF", "pdf", "PDF sənədi yarat", "Create a PDF document", "pdf", "application/pdf", sectionSchema, 60, /\bpdf\b/i],
  ];
  const referencePatterns = { word: /\b(?:word|docx)\b/i, excel: /\b(?:excel|xlsx|sheet|worksheet|spreadsheet)\b|cədvəl/i, powerpoint: /\b(?:powerpoint|pptx|slide|presentation)\b|təqdimat/i, pdf: /\bpdf\b/i };
  for (const [id, name, icon, description, descriptionEn, extension, mimeType, unitSchema, limit, intentPattern] of definitions) registry.register({
    id, name, icon, description, descriptionEn, extension, mimeType,
    outputLabel: { docx: "Word Document", xlsx: "Excel Workbook", pptx: "PowerPoint Presentation", pdf: "PDF Document" }[extension],
    capabilities: ["artifact_generation", "artifact_editing"], acceptedInputs: ["text", "strategy", "task", "upload", "research", "artifact"], outputTypes: [extension],
    permissionRequirements: ["context:read", "artifacts:write"], availability: available, status: "available", schemas: schemasFor(unitSchema, limit), intentPattern,
    referencePattern: referencePatterns[id],
    execute: context => context.generateArtifact(registry.get(id)),
  });
  registry.register({ id: "web", name: "Web", icon: "globe", description: "internetdə araşdırma apar", descriptionEn: "Research the web", capabilities: ["web_research"],
    acceptedInputs: ["text", "strategy", "research"], outputTypes: ["research"], permissionRequirements: ["context:read", "web:search"],
    availability: available, status: "available", execute: context => context.research(),
  });
  registry.register({
    id: "deep-research",
    name: "Deep Research",
    icon: "research",
    description: "çoxmərhələli dərin araşdırma və faktiki hesabat",
    descriptionEn: "Multi-step autonomous deep research and verified report",
    capabilities: ["deep_research", "web_research"],
    acceptedInputs: ["text", "strategy", "research"],
    outputTypes: ["research"],
    permissionRequirements: ["context:read", "web:search"],
    availability: available,
    status: "available",
    execute: context => context.research(),
  });
  return registry;
}

export function resolveCapabilityIntent({ registry, pluginIds = [], prompt, previousArtifact }) {
  if (pluginIds.length) {
    const plugins = [...new Set(pluginIds)].map(id => { const plugin = registry.get(id); if (!plugin) throw new Error("Unknown plugin"); return plugin; });
    // Research is a dependency of artifact creation regardless of token order.
    return { intent: plugins.some(plugin => plugin.capabilities.includes("artifact_generation")) ? "artifact_generation" : plugins.some(plugin => plugin.capabilities.includes("web_research")) ? "web_research" : "capability_execution", plugins: plugins.sort((a, b) => Number(b.capabilities.includes("web_research")) - Number(a.capabilities.includes("web_research"))) };
  }
  const editing = /(?:qısalt|dəyiş|əlavə et|yenilə|redaktə|shorten|edit|update|revise|add|remove|sil\b)/i.test(prompt);
  if (editing && previousArtifact) {
    const plugin = registry.get(previousArtifact.pluginId);
    if (plugin) return { intent: "artifact_generation", plugins: [plugin], editing: true };
  }
  if (/(?:hazırla|yarat|çevir|fayl.*kimi|sənəd|create|generate|make|export|convert|prepare)/i.test(prompt)) {
    // A slash-separated export format is usually a product feature, not a
    // request to create a workbook (for example, "plan hazırla ... Excel/CSV").
    const plugin = registry.detect(prompt.replace(/\b(?:excel\s*\/\s*csv|csv\s*\/\s*excel)\b/gi, ""));
    if (plugin) return { intent: "artifact_generation", plugins: [plugin] };
  }
  return { intent: "chat", plugins: [] };
}
