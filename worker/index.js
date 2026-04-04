// ======================================================
// 1. DATA IMPORTS
// ======================================================

import GPUS from "./data/GPUs-Grid view.json"
import CPUS from "./data/CPUs-Grid view.json"
import PSUS from "./data/PSUs-Grid view.json"
import PURPOSE_RULES from "./data/Purpose Table-Grid view.json"
import MOTHERBOARDS from "./data/Motherboard Table-Grid view.json"
import RAMS from "./data/RAM-Grid view.json"
import STORAGE from "./data/Storage-Grid view.json"

// ======================================================
// 2. ENV
// ======================================================

export interface Env {
  HF_TOKEN: string
}

// ======================================================
// 3. CONFIG
// ======================================================

const ALLOW_ORIGIN = "https://generic-department-250014.framer.app"
const MODEL = "Qwen/Qwen2.5-7B-Instruct"
const HF_URL = "https://router.huggingface.co/v1/chat/completions"

// ======================================================
// 4. BASIC HELPERS
// ======================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  }
}


// ======================================================
// HELPER: BUDGET INTENT DETECTION (Loop Prevention)
// ======================================================

function detectBudgetIntent(userText: string, currentBudget: number, pendingSuggestion: number | null): number | null {
  const lower = userText.toLowerCase().trim();

  const affirmationWords = ["yes", "yeah", "sure", "ok", "do it", "go ahead", "increase", "proceed", "fix it", "please", "apply"];
  const isAffirmation = affirmationWords.some(word => lower.includes(word));

  if (isAffirmation && pendingSuggestion !== null && pendingSuggestion > 0) {
    return pendingSuggestion > currentBudget ? pendingSuggestion : currentBudget + 100;
  }

  const explicitMatch = userText.match(/(?:\$|budget|to|make it|increase)?\s*(\d{3,5})/i);
  if (explicitMatch && explicitMatch[1]) {
    const val = Number(explicitMatch[1]);
    if (val >= 200 && val !== currentBudget) return val;
    if (val < 200 && (lower.includes("add") || lower.includes("increase") || lower.includes("more"))) {
      return currentBudget + val;
    }
  }

  return null;
}

function buildPrompt(userInput: string) {
  return `Extract only these three values from the user input.

Rules:
- budget_usd: number only (USD). If missing, estimate reasonably.
- purpose: must be exactly one of these values:
  Gaming
  Competitive Gaming
  Content Creation
  Streaming
  Office/School
- performance_tier: one of (Entry, Mid, High).

Mapping guidance:
- esports, fps, competitive, valorant, cs2 → Competitive Gaming
- gaming → Gaming
- video editing, rendering, blender, premiere, design → Content Creation
- streaming, twitch, broadcasting → Streaming
- homework, school, office, browsing, microsoft office → Office/School

If the user's request matches multiple purposes, choose the dominant one.

Return ONLY valid JSON in this format:
{
  "budget_usd": "",
  "purpose": "",
  "performance_tier": ""
}

User input:
${userInput}`
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

// ======================================================
// CHAT PROMPT (UPDATED – Full Analysis + Upgradability)
// ======================================================

function buildChatSummaryPrompt(
  userInput: string,
  purpose: string,
  build: any,
  issues: any = {},
  history: any[] = [],
  confidence: any = null
) {
  const { cpu, gpu, ram, motherboard, storage, psu, totalCost } = build;
  const userBudget = Number(issues.userBudget) || 0;
  const supportMissing = !ram || !motherboard || !psu || !storage;
  const isFixedNow = issues.budgetWasOverridden && !supportMissing;
  const suggestedBudget = issues.suggestedBudget;
  const isLooping = userInput.toLowerCase().includes("yes") && supportMissing;

  const buildList = `
CPU: ${cpu?.Name || "❌ Not Selected"} – $${cpu?.Price || "?"}
GPU: ${gpu?.Name || "❌ Not Selected"} – $${gpu?.Price || "?"}
RAM: ${ram?.Name || "❌ Waiting"} – $${ram?.Price || "?"}
Motherboard: ${motherboard?.Name || "❌ Waiting"} – $${motherboard?.Price || "?"}
Storage: ${storage?.Name || "❌ Waiting"} – $${storage?.Price || "?"}
PSU: ${psu?.Name || "❌ Waiting"} – $${psu?.Price || "?"}
Total: $${totalCost}
`;

  // Build upgrade path info from motherboard data
  const moboMaxRam = motherboard ? Number(motherboard.MaxRam_GB ?? 0) : 0;
  const moboM2Slots = motherboard ? Number(motherboard["M2 Slots"] ?? 0) : 0;
  const moboTier = motherboard ? String(motherboard.Tier ?? "") : "";
  const psuWattage = psu ? Number(psu.Wattage ?? 0) : 0;
  const psuRequiredWattage = Number(gpu?.["MinPSU_Wattage"] ?? 0);
  const psuHeadroom = psuWattage - psuRequiredWattage;
  const ramCapacity = ram ? Number(ram.CapacityGB ?? 0) : 0;
  const cpuLevel = cpu ? Number(cpu.CPU_Level_Number ?? 0) : 0;
  const gpuRequiredCpuLevel = gpu ? cpuLevelTextToNumber(String(gpu["Required CPU Level"] ?? "Medium")) : 0;

  // Confidence data
  const confidenceLevel = confidence?.level || "Unknown";
  const bottleneckCheck = confidence?.checks?.find((c: any) => c.key === "bottleneck");
  const powerCheck = confidence?.checks?.find((c: any) => c.key === "power");
  const upgradeCheck = confidence?.checks?.find((c: any) => c.key === "upgrade");

  return `
You are RedCore, a veteran PC builder and hardware advisor.
You speak naturally, concisely, and with authority. No robotic language.

CONTEXT:
User Budget: $${userBudget}
Purpose: ${purpose}
Missing Parts: ${supportMissing ? "YES" : "NO"}
JUST FIXED: ${isFixedNow ? "YES" : "NO"}
LOOP DETECTED: ${isLooping ? "YES" : "NO"}
Build Confidence: ${confidenceLevel}

User Input: "${userInput}"

---

### RESPONSE RULES:

**1. IF LOOP DETECTED (Budget updated but still missing parts):**
   - SAY: "The budget updated to $${userBudget}, but we're still short on support parts."
   - MANDATORY: Ask: "To guarantee a complete build, please increase to **$${suggestedBudget}**."
   - Do NOT show the list or analysis.

**2. IF PARTS ARE MISSING (First time fail):**
   - SAY: "The ${cpu?.Name || "CPU"} ($${cpu?.Price || "?"}) and ${gpu?.Name || "GPU"} ($${gpu?.Price || "?"}) take up most of the budget, leaving no room for the motherboard, RAM, PSU, and storage."
   - MANDATORY: Ask: "Please increase the budget to **$${suggestedBudget}** to complete this build."
   - Do NOT show the list or analysis.

**3. IF BUILD IS VALID (All 6 parts present):**
   Output the response in this EXACT order:

   **A. THE BUILD LIST:**
${buildList}

   **B. PART-BY-PART ANALYSIS (Why Each Part):**
   For each part, write ONE sentence explaining why it was chosen for ${purpose}. Be specific.
   Format:
   - **CPU – ${cpu?.Name || "?"}:** [Why this CPU fits. Mention core count, clock speed relevance to ${purpose}.]
   - **GPU – ${gpu?.Name || "?"}:** [Why this GPU fits. Mention VRAM, performance class, what resolution/settings it targets.]
   - **RAM – ${ram?.Name || "?"}:** [Why this capacity and speed. Mention if ${ramCapacity}GB is enough for ${purpose}.]
   - **Motherboard – ${motherboard?.Name || "?"}:** [Why this board. Mention socket match, chipset, expansion.]
   - **Storage – ${storage?.Name || "?"}:** [Why this drive. Mention read/write speed if NVMe, capacity.]
   - **PSU – ${psu?.Name || "?"}:** [Why this wattage. Mention headroom over the ${psuRequiredWattage}W requirement.]

   **C. COMPATIBILITY CHECK:**
   - Bottleneck: ${bottleneckCheck?.passed ? `✅ No bottleneck – CPU Level ${cpuLevel} meets GPU requirement of ${gpuRequiredCpuLevel}.` : `⚠️ Potential bottleneck – CPU Level ${cpuLevel} is below GPU requirement of ${gpuRequiredCpuLevel}.`}
   - Power: ${powerCheck?.passed ? `✅ PSU delivers ${psuWattage}W with ${psuHeadroom}W headroom.` : `⚠️ PSU may be tight at ${psuWattage}W vs ${psuRequiredWattage}W required.`}
   - Confidence: **${confidenceLevel}**

   **D. UPGRADE PATH (What Can Be Improved Later):**
   Write 2-4 bullet points about future upgrades. Consider:
   - RAM: Currently ${ramCapacity}GB, motherboard supports up to ${moboMaxRam}GB. ${ramCapacity < moboMaxRam ? `Can upgrade to ${moboMaxRam}GB later.` : "Already at max."}
   - Storage: ${moboM2Slots > 1 ? `${moboM2Slots} M.2 slots available – can add another NVMe drive.` : "Only 1 M.2 slot – would need SATA for more storage."}
   - GPU: ${psuHeadroom > 50 ? `PSU has ${psuHeadroom}W headroom – could support a stronger GPU in the future.` : `PSU is tight – upgrading the GPU would also require a bigger PSU.`}
   - CPU: ${moboTier === "Mid" || moboTier === "High" ? `Motherboard supports higher-tier CPUs on the same socket.` : `Entry-tier board – CPU upgrade options may be limited.`}

**4. IF USER ASKS A QUESTION (not about the build):**
   - Answer directly. No list, no analysis.

---

Respond now. Keep it professional but conversational. No filler words.
`;
}

// ======================================================
// 4.5 INPUT VALIDATION SYSTEM
// ======================================================

// --- CONSTANTS ---
const VALID_PURPOSES = [
    "Gaming",
    "Competitive Gaming",
    "Content Creation",
    "Streaming",
    "Office/School",
]

const VALID_TIERS: TierText[] = ["Entry", "Mid", "High"]

const MIN_PROMPT_LENGTH = 10
const MAX_PROMPT_LENGTH = 500
const MIN_BUDGET = 300
const MAX_BUDGET = 10000
const MAX_HISTORY_LENGTH = 20
const MAX_HISTORY_MESSAGE_LENGTH = 1000

// --- TYPES ---
interface ValidationResult {
    valid: boolean
    errors: string[]
    sanitized: Record<string, any>
}

// --- SANITIZATION ---

function sanitizeText(input: string): string {
    if (typeof input !== "string") return ""
    return input
        .replace(/<[^>]*>/g, "")                    // Strip HTML tags
        .replace(/javascript:/gi, "")                // Strip JS protocol
        .replace(/on\w+\s*=/gi, "")                  // Strip event handlers
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // Strip control chars
        .trim()
}

function sanitizeNumber(input: any, fallback: number): number {
    const num = Number(input)
    if (isNaN(num) || !isFinite(num)) return fallback
    return num
}

// --- VALIDATORS ---

function validatePromptText(text: string): string[] {
    const errors: string[] = []
    const trimmed = (text || "").trim()

    if (!trimmed) {
        errors.push("Prompt is required.")
        return errors
    }

    if (trimmed.length < MIN_PROMPT_LENGTH) {
        errors.push(
            `Prompt too short (${trimmed.length} chars). Minimum is ${MIN_PROMPT_LENGTH}.`
        )
    }

    if (trimmed.length > MAX_PROMPT_LENGTH) {
        errors.push(
            `Prompt too long (${trimmed.length} chars). Maximum is ${MAX_PROMPT_LENGTH}.`
        )
    }

    // Must contain at least 2 real words
    const words = trimmed.split(/\s+/).filter((w) => /[a-zA-Z]{2,}/.test(w))
    if (words.length < 2) {
        errors.push("Prompt must contain at least 2 real words.")
    }

    // Spam detection: repeated characters
    if (/(.)\1{7,}/.test(trimmed)) {
        errors.push("Prompt appears to be spam (repeated characters).")
    }

    return errors
}

function validateBudget(budget: any): { value: number; errors: string[] } {
    const errors: string[] = []
    const num = Number(budget)

    if (budget === undefined || budget === null || budget === "") {
        // Budget is optional for auto mode — will be extracted by AI
        return { value: 0, errors: [] }
    }

    if (isNaN(num) || !isFinite(num)) {
        errors.push("Budget must be a valid number.")
        return { value: 0, errors }
    }

    if (!Number.isInteger(num)) {
        // Allow but round
    }

    if (num < MIN_BUDGET) {
        errors.push(
            `Budget too low ($${num}). Minimum is $${MIN_BUDGET}.`
        )
    }

    if (num > MAX_BUDGET) {
        errors.push(
            `Budget too high ($${num}). Maximum is $${MAX_BUDGET}.`
        )
    }

    return { value: Math.round(Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, num))), errors }
}

function validatePurpose(purpose: any): { value: string; errors: string[] } {
    const errors: string[] = []

    if (!purpose || typeof purpose !== "string") {
        // Purpose is optional — will be extracted by AI
        return { value: "", errors: [] }
    }

    const trimmed = purpose.trim()

    if (trimmed && !VALID_PURPOSES.includes(trimmed)) {
        errors.push(
            `Invalid purpose "${trimmed}". Must be one of: ${VALID_PURPOSES.join(", ")}.`
        )
        // Try fuzzy match
        const lower = trimmed.toLowerCase()
        if (trimmed && !VALID_PURPOSES.includes(trimmed)) {
    errors.push(`Invalid purpose`)
}
    }

    return { value: trimmed, errors }
}

function validateMode(mode: any): { value: string; errors: string[] } {
    const errors: string[] = []
    const validModes = ["auto", "experienced", ""]

    if (mode && typeof mode === "string" && !validModes.includes(mode)) {
        errors.push(`Invalid mode "${mode}". Must be "auto" or "experienced".`)
    }

    return { value: mode || "auto", errors }
}

function validateExperiencedFields(body: any): string[] {
    const errors: string[] = []

    if (body.mode !== "experienced") return []

    // CPU name required
    if (!body.cpu || typeof body.cpu !== "string" || body.cpu.trim().length < 2) {
        errors.push("Experienced mode requires a CPU name (at least 2 characters).")
    }

    // GPU name required
    if (!body.gpu || typeof body.gpu !== "string" || body.gpu.trim().length < 2) {
        errors.push("Experienced mode requires a GPU name (at least 2 characters).")
    }

    // Budget required for experienced
    if (!body.budget || Number(body.budget) <= 0) {
        errors.push("Experienced mode requires a valid budget.")
    }

    // Validate CPU exists in database
    if (body.cpu && typeof body.cpu === "string") {
        const found = findPartByName(CPUS, body.cpu.trim())
        if (!found) {
            errors.push(
                `CPU "${body.cpu}" not found in our database. Please check the name.`
            )
        }
    }

    // Validate GPU exists in database
    if (body.gpu && typeof body.gpu === "string") {
        const found = findPartByName(GPUS, body.gpu.trim())
        if (!found) {
            errors.push(
                `GPU "${body.gpu}" not found in our database. Please check the name.`
            )
        }
    }

    // CPU/GPU name length limits
    if (body.cpu && body.cpu.length > 100) {
        errors.push("CPU name too long (max 100 characters).")
    }
    if (body.gpu && body.gpu.length > 100) {
        errors.push("GPU name too long (max 100 characters).")
    }

    return errors
}

function validateChatHistory(history: any) {
    if (!Array.isArray(history)) return { value: [], errors: [] }

    return {
        value: history.slice(-10),
        errors: []
    }
}



// --- MASTER VALIDATOR ---

function validateRequestBody(body: any): ValidationResult {
    const allErrors: string[] = []

    // 1. Body type check
    if (!body || typeof body !== "object") {
        return {
            valid: false,
            errors: ["Request body must be a JSON object."],
            sanitized: {},
        }
    }

    // 2. Mode
    const modeResult = validateMode(body.mode)
    allErrors.push(...modeResult.errors)

    const isExperienced = modeResult.value === "experienced"

    // 3. Prompt text (required for auto mode)
    let sanitizedInputs = ""
    if (!isExperienced) {
        if (!body.inputs || typeof body.inputs !== "string") {
            allErrors.push("Field 'inputs' is required and must be a string.")
        } else {
            sanitizedInputs = sanitizeText(body.inputs)
            const promptErrors = validatePromptText(sanitizedInputs)
            allErrors.push(...promptErrors)
        }
    } else {
        sanitizedInputs = sanitizeText(body.inputs || "")
    }

    // 4. Budget
    const budgetResult = validateBudget(body.budget)
    allErrors.push(...budgetResult.errors)

    // 5. Purpose
    const purposeResult = validatePurpose(body.purpose)
    allErrors.push(...purposeResult.errors)

    // 6. Experienced-mode-specific fields
    if (isExperienced) {
        const expErrors = validateExperiencedFields(body)
        allErrors.push(...expErrors)
    }

    // 7. Chat history
    const historyResult = validateChatHistory(body.history)
    allErrors.push(...historyResult.errors)



    // 9. Unexpected fields check (log but don't reject)
    const allowedFields = [
        "inputs",
        "budget",
        "purpose",
        "mode",
        "cpu",
        "gpu",
        "history",
    ]
    

    // BUILD SANITIZED OUTPUT
    const sanitized: Record<string, any> = {
        inputs: sanitizedInputs,
        budget: budgetResult.value,
        purpose: purposeResult.value,
        mode: modeResult.value,
        cpu: isExperienced ? sanitizeText(body.cpu || "") : "",
        gpu: isExperienced ? sanitizeText(body.gpu || "") : "",
        history: historyResult.value,
    }

    return {
        valid: allErrors.length === 0,
        errors: allErrors,
        sanitized,
    }
}

// --- ERROR RESPONSE BUILDER ---

function validationErrorResponse(errors: string[]): Response {
    return new Response(
        JSON.stringify({
            status: "validation_error",
            errors,
            message: errors[0] || "Invalid request.",
            // Provide hints for common mistakes
            hints: {
                min_budget: MIN_BUDGET,
                max_budget: MAX_BUDGET,
                valid_purposes: VALID_PURPOSES,
                min_prompt_length: MIN_PROMPT_LENGTH,
                max_prompt_length: MAX_PROMPT_LENGTH,
            },
        }),
        {
            status: 422,
            headers: corsHeaders(),
        }
    )
}

// --- RATE LIMITER (Basic In-Memory) ---

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
const RATE_LIMIT_MAX = 15        // 15 requests per minute per IP

function checkRateLimit(ip: string): boolean {
    const now = Date.now()
    const entry = rateLimitMap.get(ip)

    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
        return true
    }

    if (entry.count >= RATE_LIMIT_MAX) {
        return false
    }

    entry.count++
    return true
}

function rateLimitResponse(): Response {
    return new Response(
        JSON.stringify({
            status: "rate_limited",
            message:
                "Too many requests. Please wait a moment before trying again.",
            retry_after_seconds: Math.ceil(RATE_LIMIT_WINDOW / 1000),
        }),
        {
            status: 429,
            headers: {
                ...corsHeaders(),
                "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW / 1000)),
            },
        }
    )
}

// Cleanup old entries periodically (prevent memory leak)
function cleanupRateLimitMap() {
    const now = Date.now()
    for (const [key, val] of rateLimitMap.entries()) {
        if (now > val.resetAt) rateLimitMap.delete(key)
    }
}

// ======================================================
// 5. TIER / PURPOSE TYPES
// ======================================================

type TierText = "Entry" | "Mid" | "High"

function tierTextToNumber(t: TierText): number {
  if (t === "Entry") return 1
  if (t === "Mid") return 2
  return 3
}

function numberToTierText(n: number): TierText {
  if (n <= 1) return "Entry"
  if (n === 2) return "Mid"
  return "High"
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function getGpuShift(purpose: string): number {
  const rule = PURPOSE_RULES.find((r: any) => r.Name === purpose)
  if (!rule) return 0
  if (rule["GPU Tier Rule"] === "+1") return 1
  if (rule["GPU Tier Rule"] === "-1") return -1
  return 0
}

function minimumGpuTierForPurpose(purpose: string): TierText {
  const table: Record<string, TierText> = {
    "Gaming": "Entry",
    "Competitive Gaming": "Mid",
    "Content Creation": "Mid",
    "Streaming": "Mid",
    "Office/School": "Entry"
  }
  return table[purpose] ?? "Entry"
}

function getPreferredRamGb(purpose: string): number {
  const rule = PURPOSE_RULES.find((r: any) => r.Name === purpose)
  if (!rule) return 16
  return Number(rule.Preferred_RAM_GB ?? 16)
}

function getStorageShift(purpose: string): number {
  const rule = PURPOSE_RULES.find((r: any) => r.Name === purpose)
  if (!rule) return 0
  if (rule["Storage Tier Rule"] === "+1") return 1
  if (rule["Storage Tier Rule"] === "-1") return -1
  return 0
}

// ======================================================
// 6. BUDGET ALLOCATION RULES
// ======================================================

function gpuBudgetPercent(purpose: string, tier: TierText) {
  const table: any = {
    "Gaming": { Entry: 0.30, Mid: 0.35, High: 0.40 },
    "Competitive Gaming": { Entry: 0.30, Mid: 0.35, High: 0.40 },
    "Content Creation": { Entry: 0.25, Mid: 0.30, High: 0.35 },
    "Streaming": { Entry: 0.28, Mid: 0.32, High: 0.35 },
    "Office/School": { Entry: 0.30, Mid: 0.30, High: 0.30 },
  }
  return table[purpose]?.[tier] ?? 0.30
}

function cpuBudgetPercent(purpose: string): number {
  const table: Record<string, number> = {
    "Gaming": 0.20,
    "Competitive Gaming": 0.22,
    "Content Creation": 0.25,
    "Streaming": 0.22,
    "Office/School": 0.20,
  }
  return table[purpose] ?? 0.20
}

function psuBudgetPercent(purpose: string, gpuTier: TierText): number {
  const table: Record<string, Record<TierText, number>> = {
    "Gaming": { Entry: 0.10, Mid: 0.09, High: 0.08 },
    "Competitive Gaming": { Entry: 0.10, Mid: 0.09, High: 0.08 },
    "Content Creation": { Entry: 0.10, Mid: 0.09, High: 0.08 },
    "Streaming": { Entry: 0.10, Mid: 0.09, High: 0.08 },
    "Office/School": { Entry: 0.10, Mid: 0.09, High: 0.08 }
  }
  return table[purpose]?.[gpuTier] ?? 0.10
}

function motherboardBudgetPercent(gpuTier: TierText): number {
  const table: Record<TierText, number> = {
    "Entry": 0.14,
    "Mid": 0.12,
    "High": 0.10
  }
  return table[gpuTier] ?? 0.14
}

function ramBudgetPercent(purpose: string): number {
  const table: Record<string, number> = {
    "Gaming": 0.18,
    "Competitive Gaming": 0.18,
    "Content Creation": 0.22,
    "Streaming": 0.20,
    "Office/School": 0.18,
  }
  return table[purpose] ?? 0.18
}

function storageBudgetPercent(purpose: string): number {
  const table: Record<string, number> = {
    "Gaming": 0.10,
    "Competitive Gaming": 0.10,
    "Content Creation": 0.14,
    "Streaming": 0.12,
    "Office/School": 0.08,
  }
  return table[purpose] ?? 0.10
}

// ======================================================
// 7. CPU / PSU HELPER RULES
// ======================================================

function cpuLevelTextToNumber(level: string): number {
  const t = (level || "").toLowerCase()
  if (t.includes("high")) return 3
  if (t.includes("med")) return 2
  if (t.includes("low")) return 1
  return 2
}

function calculateRequiredPSU(gpu: any) {
  return Number(gpu?.["MinPSU_Wattage"] ?? 0)
}

// ======================================================
// 8. DATABASE SEARCH HELPERS
// ======================================================

function findBestGPU(tier: TierText, budget: number) {
  return GPUS
    .filter((g: any) => g.Tier === tier && Number(g.Price) <= budget)
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null
}

function findBestCPU(requiredLevel: number, cpuBudget: number, socket = "AM4") {
  return CPUS
    .filter((c: any) =>
      (socket ? String(c.Socket).toUpperCase() === socket : true) &&
      Number(c.CPU_Level_Number) >= requiredLevel &&
      Number(c.Price) <= cpuBudget
    )
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null
}

function findBestPSU(requiredWattage: number, required8Pin: number, psuBudget: number) {
  return PSUS
    .filter((p: any) =>
      Number(p.Wattage) >= requiredWattage &&
      Number(p.pcie_8pin_count) >= required8Pin &&
      Number(p.Price) <= psuBudget
    )
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null
}

function findBestMotherboard(socket: string, ramType: string, gpuTier: TierText, budget: number) {
  return MOTHERBOARDS
    .filter((m: any) =>
      String(m.Socket).toUpperCase() === socket &&
      String(m.RAMType).toUpperCase() === ramType &&
      String(m.Tier) === gpuTier &&
      Number(m.Price) <= budget
    )
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null
}

function findBestRAM(ramType: string, capacityGb: number, budget: number) {
  return RAMS
    .filter((r: any) =>
      String(r.DDRType).toUpperCase() === ramType &&
      Number(r.CapacityGB) === capacityGb &&
      Number(r.Price) <= budget
    )
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null
}

function findBestStorage(tier: TierText, budget: number) {
  return STORAGE
    .filter((s: any) =>
      String(s.Tier) === tier &&
      Number(s.Price) <= budget
    )
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null
}

function getLowestRamPrice(ramType: string): number {
  const prices = RAMS
    .filter((r: any) => String(r.DDRType).toUpperCase() === ramType)
    .map((r: any) => Number(r.Price))
    .filter((p: number) => !Number.isNaN(p))
  return prices.length === 0 ? 0 : Math.min(...prices)
}

function getLowestStoragePrice(): number {
  const prices = STORAGE
    .map((s: any) => Number(s.Price))
    .filter((p: number) => !Number.isNaN(p))
  return prices.length === 0 ? 0 : Math.min(...prices)
}

// --- CHEAPEST FINDERS ---

function findCheapestGPU(tier: TierText) {
  return GPUS.filter((g: any) => String(g.Tier) === tier)
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))[0] ?? null
}

function findCheapestCPU(requiredLevel: number, socket = "AM4") {
  return CPUS.filter((c: any) =>
    (socket ? String(c.Socket).toUpperCase() === socket : true) &&
    Number(c.CPU_Level_Number) >= requiredLevel
  ).sort((a: any, b: any) => Number(a.Price) - Number(b.Price))[0] ?? null
}

function findCheapestPSU(requiredWattage: number, required8Pin: number) {
  return PSUS.filter((p: any) =>
    Number(p.Wattage) >= requiredWattage &&
    Number(p.pcie_8pin_count) >= required8Pin
  ).sort((a: any, b: any) => Number(a.Price) - Number(b.Price))[0] ?? null
}

function findCheapestMotherboard(socket: string, ramType: string, gpuTier: TierText) {
  return MOTHERBOARDS.filter((m: any) =>
    String(m.Socket).toUpperCase() === socket &&
    String(m.RAMType).toUpperCase() === ramType &&
    String(m.Tier) === gpuTier
  ).sort((a: any, b: any) => Number(a.Price) - Number(b.Price))[0] ?? null
}

function findCheapestRAM(ramType: string, capacityGb: number) {
  return RAMS.filter((r: any) =>
    String(r.DDRType).toUpperCase() === ramType &&
    Number(r.CapacityGB) === capacityGb
  ).sort((a: any, b: any) => Number(a.Price) - Number(b.Price))[0] ?? null
}

function findCheapestStorage(tier: TierText) {
  return STORAGE.filter((s: any) => String(s.Tier) === tier)
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))[0] ?? null
}

function findPartByName(data: any[], nameQuery: string) {
  if (!nameQuery) return null;
  const cleanQuery = nameQuery.toLowerCase().replace(/[^a-z0-9]/g, "");
  let found = data.find((item: any) =>
    String(item.Name).toLowerCase().replace(/[^a-z0-9]/g, "") === cleanQuery
  );
  if (!found) {
    found = data.find((item: any) =>
      String(item.Name).toLowerCase().replace(/[^a-z0-9]/g, "").includes(cleanQuery)
    );
  }
  return found || null;
}

// ======================================================
// 9. AUTO-MODE SELECTORS
// ======================================================

function selectPSU(budgetUsd: number, purpose: string, gpu: any, gpuTier: TierText) {
  const psuBudget = Math.round(budgetUsd * psuBudgetPercent(purpose, gpuTier))
  const requiredWattage = calculateRequiredPSU(gpu)
  const required8Pin = Number(gpu?.["PCIe 8pin Required"] ?? 0)
  const psu = findBestPSU(requiredWattage, required8Pin, psuBudget)
  if (!psu) {
    return { error: "No PSU found.", PSU_Budget: psuBudget, PSU_Required_Wattage: requiredWattage, PSU_Required_8Pin: required8Pin }
  }
  return { psu, PSU_Budget: psuBudget, PSU_Percent: psuBudgetPercent(purpose, gpuTier), PSU_Required_Wattage: requiredWattage, PSU_Required_8Pin: required8Pin }
}

function selectMotherboard(budgetUsd: number, gpuTier: TierText, cpu: any) {
  const mbBudget = Math.round(budgetUsd * motherboardBudgetPercent(gpuTier))
  const socket = String(cpu?.Socket ?? "").toUpperCase()
  const ramType = String(cpu?.["Supported RAM Type"] ?? "DDR4").toUpperCase()
  const motherboard = findBestMotherboard(socket, ramType, gpuTier, mbBudget)
  if (!motherboard) {
    return { error: "No motherboard found.", MB_Budget: mbBudget, MB_Required_Socket: socket, MB_Required_RAMType: ramType, MB_Required_Tier: gpuTier }
  }
  return { motherboard, MB_Budget: mbBudget, MB_Percent: motherboardBudgetPercent(gpuTier) }
}


function selectRAM(ramBudget: number, purpose: string, motherboard: any) {
  const ramType = String(motherboard?.RAMType ?? "DDR4").toUpperCase()
  const preferredRamGb = getPreferredRamGb(purpose)
  let ram = findBestRAM(ramType, preferredRamGb, ramBudget)
  if (ram) return { ram, RAM_Budget: ramBudget, RAM_Preferred_GB: preferredRamGb, RAM_Adjusted: "No" }
  if (preferredRamGb === 32) {
    ram = findBestRAM(ramType, 16, ramBudget)
    if (ram) return { ram, RAM_Budget: ramBudget, RAM_Preferred_GB: preferredRamGb, RAM_Adjusted: "Yes", RAM_Adjustment_Message: "32GB not available, selected 16GB." }
  }
  return { error: "No RAM found.", RAM_Budget: ramBudget, RAM_Type: ramType, RAM_Preferred_GB: preferredRamGb }
}

function selectStorageAuto(storageBudget: number, purpose: string, gpuTier: TierText) {
  const baseTierNumber = tierTextToNumber(gpuTier)
  const storageShift = getStorageShift(purpose)
  let targetTierNumber = clamp(baseTierNumber + storageShift, 1, 3)
  while (targetTierNumber >= 1) {
    const targetTierText = numberToTierText(targetTierNumber)
    const storage = findBestStorage(targetTierText, storageBudget)
    if (storage) return { storage, Storage_Budget: storageBudget, Storage_Final_Tier: targetTierText, Storage_Adjusted: targetTierNumber !== baseTierNumber + storageShift ? "Yes" : "No" }
    targetTierNumber--
  }
  return { error: "No storage found.", Storage_Budget: storageBudget }
}

// ======================================================
// 10. EXPERIENCED-MODE SELECTORS
// ======================================================

function expSelectPSU(budget: number, gpu: any) {
  const b = Math.floor(budget * 0.10);
  const w = Number(gpu?.["MinPSU_Wattage"] ?? 0);
  const pin = Number(gpu?.["PCIe 8pin Required"] ?? 0);
  const psu = findBestPSU(w, pin, b);
  if (!psu) return { error: "No PSU", PSU_Budget: b, PSU_Required_Wattage: w, PSU_Required_8Pin: pin };
  return { psu, PSU_Budget: b, PSU_Percent: 0.10, PSU_Required_Wattage: w, PSU_Required_8Pin: pin };
}

function expSelectMotherboard(budget: number, tier: string, cpu: any) {
  const b = Math.floor(budget * 0.12);
  const s = String(cpu?.Socket ?? "").toUpperCase();
  const r = String(cpu?.["Supported RAM Type"] ?? "DDR4").toUpperCase();
  const m = MOTHERBOARDS
    .filter((x: any) => String(x.Socket).toUpperCase() === s && String(x.RAMType).toUpperCase() === r && (String(x.Tier) === tier || String(x.Tier) === "Entry") && Number(x.Price) <= b)
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null;
  if (!m) return { error: "No Mobo", MB_Budget: b };
  return { motherboard: m, MB_Budget: b, MB_Percent: 0.12 };
}

function expSelectRAM(budget: number, mobo: any) {
  const t = String(mobo?.RAMType ?? "DDR4").toUpperCase();
  const r = RAMS
    .filter((x: any) => String(x.DDRType).toUpperCase() === t && Number(x.CapacityGB) === 16 && Number(x.Price) <= budget)
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null;
  if (!r) return { error: "No RAM", RAM_Budget: budget };
  return { ram: r, RAM_Budget: budget };
}

function expSelectStorage(budget: number) {
  const s = STORAGE
    .filter((x: any) => Number(x.Price) <= budget)
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null;
  if (!s) return { error: "No Storage", Storage_Budget: budget };
  return { storage: s, Storage_Budget: budget };
}

// ======================================================
// 11. EXPERIENCED BUILD LOGIC
// ======================================================

function selectExperiencedBuild(budgetUsd: number, purpose: string, manualCpuName: string, manualGpuName: string) {
  const gpu = findPartByName(GPUS, manualGpuName);
  const cpu = findPartByName(CPUS, manualCpuName);
  if (!gpu || !cpu) return { error: `Could not find the specific CPU or GPU requested.` };

  const gpuTier = gpu.Tier as string;
  const cpuPrice = Number(cpu.Price);
  const gpuPrice = Number(gpu.Price);
  const estSupportCost = 300;
  const estimatedTotal = cpuPrice + gpuPrice + estSupportCost;
  let remaining = budgetUsd - cpuPrice - gpuPrice;
  let budgetWasAdjusted = false;

  if (remaining <= 50) {
    return {
      gpuResult: { gpu, FinalGPU_Text: gpuTier, GPU_Budget: gpuPrice },
      cpuResult: { cpu, CPU_Budget: cpuPrice },
      error: "Budget too low", missingParts: true, estimatedTotal
    };
  }

  let psuResult = expSelectPSU(budgetUsd, gpu);
  if (psuResult.error) {
    const emerg = Math.floor(remaining * 0.30);
    const w = Number(gpu?.["MinPSU_Wattage"] ?? 0);
    const pin = Number(gpu?.["PCIe 8pin Required"] ?? 0);
    const psu = findBestPSU(w, pin, emerg);
    if (psu) psuResult = { psu, PSU_Budget: emerg, PSU_Percent: 0, PSU_Required_Wattage: w, PSU_Required_8Pin: pin };
  }

  let moboResult = expSelectMotherboard(budgetUsd, gpuTier, cpu);
  if (moboResult.error) moboResult = expSelectMotherboard(budgetUsd, "Entry", cpu);
  if (moboResult.error) {
    const emerg = Math.floor(remaining * 0.35);
    const s = String(cpu?.Socket ?? "").toUpperCase();
    const r = String(cpu?.["Supported RAM Type"] ?? "DDR4").toUpperCase();
    const m = MOTHERBOARDS
      .filter((x: any) => String(x.Socket).toUpperCase() === s && String(x.RAMType).toUpperCase() === r && String(x.Tier) === "Entry" && Number(x.Price) <= emerg)
      .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))[0] ?? null;
    if (m) moboResult = { motherboard: m, MB_Budget: emerg, MB_Percent: 0 };
  }

  const pCost = Number(psuResult.psu?.Price ?? 0);
  const mCost = Number(moboResult.motherboard?.Price ?? 0);
  let finalRem = remaining - pCost - mCost;
  if (finalRem < 40) finalRem = 40;

  const ramResult = expSelectRAM(finalRem * 0.55, moboResult.motherboard);
  const storageResult = expSelectStorage(finalRem * 0.45);

  return {
    gpuResult: { gpu, FinalGPU_Text: gpuTier, GPU_Budget: gpuPrice },
    cpuResult: { cpu, CPU_Budget: cpuPrice },
    psuResult, motherboardResult: moboResult, ramResult, storageResult,
    isExperienced: true, budgetWasAdjusted,
    estimatedTotal: (psuResult.psu && moboResult.motherboard && ramResult.ram && storageResult.storage)
      ? (cpuPrice + gpuPrice + pCost + mCost + Number(ramResult.ram.Price) + Number(storageResult.storage.Price))
      : estimatedTotal
  };
}

// ======================================================
// 12. MINIMUM REQUIRED BUDGET CALCULATOR
// ======================================================

function calculateMinimumRequiredBudget(purpose: string, minimumTier: TierText) {
  const gpu = findCheapestGPU(minimumTier)
  if (!gpu) return null
  const requiredCpuLevel = cpuLevelTextToNumber(String(gpu?.["Required CPU Level"] ?? "Medium"))
  const cpu = findCheapestCPU(requiredCpuLevel, "AM4")
  if (!cpu) return null
  const psu = findCheapestPSU(calculateRequiredPSU(gpu), Number(gpu?.["PCIe 8pin Required"] ?? 0))
  if (!psu) return null
  const socket = String(cpu?.Socket ?? "").toUpperCase()
  const ramType = String(cpu?.["Supported RAM Type"] ?? "DDR4").toUpperCase()
  const motherboard = findCheapestMotherboard(socket, ramType, minimumTier)
  if (!motherboard) return null
  const preferredRamGb = getPreferredRamGb(purpose)
  let ram = findCheapestRAM(ramType, preferredRamGb)
  if (!ram && preferredRamGb === 32) ram = findCheapestRAM(ramType, 16)
  if (!ram) return null
  let storageTierNumber = clamp(tierTextToNumber(minimumTier) + getStorageShift(purpose), 1, 3)
  let storage = null
  while (storageTierNumber >= 1) {
    storage = findCheapestStorage(numberToTierText(storageTierNumber))
    if (storage) break
    storageTierNumber--
  }
  if (!storage) return null
  return {
    total: Math.ceil(Number(gpu.Price) + Number(cpu.Price) + Number(psu.Price) + Number(motherboard.Price) + Number(ram.Price) + Number(storage.Price)),
    gpu, cpu, psu, motherboard, ram, storage
  }
}

function calculateRecommendedNormalBudget(
  purpose: string,
  performanceTier: TierText,
  startBudget: number,
  maxBudget = 3000
) {
  let testBudget = startBudget

  // Optimization: Jump by $50 instead of $5 to prevent script timeout
  while (testBudget <= maxBudget) {
    const testResult: any = selectCoreBuild(testBudget, purpose, performanceTier, 2, false)

    // FIX: Check if there is NO error, instead of checking for ".build"
    if (testResult && !testResult.error) {
      return testBudget
    }

    testBudget += 50
  }

  return null
}

function convertMinimumBuildToBuildResult(minimumBuild: any, purpose: string, minimumTier: TierText) {
  if (!minimumBuild) return null
  const { gpu, cpu, psu, motherboard, ram, storage } = minimumBuild
  const requiredText = String(gpu?.["Required CPU Level"] ?? "Medium")
  const requiredLevel = cpuLevelTextToNumber(requiredText)
  return {
    gpuResult: { gpu, FinalGPU_Text: minimumTier, FinalGPU_Number: tierTextToNumber(minimumTier), GPU_Adjusted: "No", GPU_Budget: Number(gpu?.Price ?? 0), GPU_Percent: null, attempts: 0, Build_Mode: "Minimum" },
    cpuResult: { cpu, CPU_Budget: Number(cpu?.Price ?? 0), CPU_Percent: null, CPU_Required_Level_Text: requiredText, CPU_Required_Level_Number: requiredLevel, Build_Mode: "Minimum" },
    psuResult: { psu, PSU_Budget: Number(psu?.Price ?? 0), PSU_Percent: null, PSU_Required_Wattage: Number(gpu?.["MinPSU_Wattage"] ?? 0), PSU_Required_8Pin: Number(gpu?.["PCIe 8pin Required"] ?? 0), Build_Mode: "Minimum" },
    motherboardResult: { motherboard, MB_Budget: Number(motherboard?.Price ?? 0), MB_Percent: null, Build_Mode: "Minimum" },
    ramResult: { ram, RAM_Budget: Number(ram?.Price ?? 0), RAM_Preferred_GB: getPreferredRamGb(purpose), RAM_Adjusted: Number(ram?.CapacityGB ?? 0) < getPreferredRamGb(purpose) ? "Yes" : "No", Build_Mode: "Minimum" },
    storageResult: { storage, Storage_Budget: Number(storage?.Price ?? 0), Storage_Final_Tier: storage?.Tier ?? null, Storage_Adjusted: "No", Build_Mode: "Minimum" },
    minimumBuildUsed: true, minimumBuildTotal: minimumBuild.total
  }
}

// ======================================================
// 13. MAIN AUTO BUILD LOOP
// ======================================================

// ======================================================
// 13. MAIN AUTO BUILD LOOP (FIXED)
// ======================================================

function selectCoreBuild(budgetUsd: number, purpose: string, performanceTier: TierText, maxRetries = 2, includeRecommendations = true) {
  const baseNumber = tierTextToNumber(performanceTier)
  const shift = getGpuShift(purpose)
  const minimumTier = minimumGpuTierForPurpose(purpose)
  const minimumTierNumber = tierTextToNumber(minimumTier)
  let finalNumber = clamp(baseNumber + shift, 1, 3)
  let downgraded = false
  let attempts = 0
  let lastAttempt: any = null

  // --- FIX START: Calculate recommendations UP FRONT ---
  // We calculate this now so we can return it even if the build is successful.
  let recommendedMinimumBudget: number | null = null
  let recommendedNormalBudget: number | null = null
  let minimumBuild: any = null

  if (includeRecommendations) {
    minimumBuild = calculateMinimumRequiredBudget(purpose, minimumTier)
    recommendedMinimumBudget = minimumBuild?.total ?? null
    recommendedNormalBudget = recommendedMinimumBudget !== null 
      ? calculateRecommendedNormalBudget(purpose, performanceTier, recommendedMinimumBudget) 
      : null
  }
  // --- FIX END ---

  while (finalNumber >= minimumTierNumber && attempts <= maxRetries) {
    const tierText = numberToTierText(finalNumber)
    const gpuBudget = Math.round(budgetUsd * gpuBudgetPercent(purpose, tierText))
    const gpu = findBestGPU(tierText, gpuBudget)
    if (!gpu) { finalNumber--; downgraded = true; attempts++; continue }

    const cpuBudget = Math.round(budgetUsd * cpuBudgetPercent(purpose))
    const requiredText = String(gpu?.["Required CPU Level"] ?? "Medium")
    const requiredLevel = cpuLevelTextToNumber(requiredText)
    const cpu = findBestCPU(requiredLevel, cpuBudget, "AM4")
    if (!cpu) { finalNumber--; downgraded = true; attempts++; continue }

    const psuResult = selectPSU(budgetUsd, purpose, gpu, tierText)
    if (psuResult?.error) { finalNumber--; downgraded = true; attempts++; continue }

    let motherboardResult = selectMotherboard(budgetUsd, tierText, cpu)
    if (motherboardResult?.error && tierText !== "Entry") motherboardResult = selectMotherboard(budgetUsd, "Entry", cpu)
    if (motherboardResult?.error) { finalNumber--; downgraded = true; attempts++; continue }

    const ramType = String(motherboardResult?.motherboard?.RAMType ?? "DDR4").toUpperCase()
    const minimumRamReserve = getLowestRamPrice(ramType)
    let currentMoboPrice = Number(motherboardResult?.motherboard?.Price ?? 0)
    let usedBudgetBeforeRam = Number(gpu.Price) + Number(cpu.Price) + Number(psuResult?.psu?.Price ?? 0) + currentMoboPrice

    if (usedBudgetBeforeRam > budgetUsd) {
      if (tierText !== "Entry" && motherboardResult.motherboard?.Tier !== "Entry") {
        const cheapMoboResult = selectMotherboard(budgetUsd, "Entry", cpu);
        if (!cheapMoboResult.error) {
          const cheapUsed = Number(gpu.Price) + Number(cpu.Price) + Number(psuResult?.psu?.Price ?? 0) + Number(cheapMoboResult.motherboard?.Price ?? 0);
          if (cheapUsed <= budgetUsd - minimumRamReserve) {
            motherboardResult = cheapMoboResult;
            usedBudgetBeforeRam = cheapUsed;
          } else {
            lastAttempt = { gpuResult: { gpu, FinalGPU_Text: tierText }, cpuResult: { cpu }, psuResult, motherboardResult }
            finalNumber--; downgraded = true; attempts++; continue
          }
        }
      } else {
        lastAttempt = { gpuResult: { gpu, FinalGPU_Text: tierText }, cpuResult: { cpu }, psuResult, motherboardResult }
        finalNumber--; downgraded = true; attempts++; continue
      }
    }

    const coreUsed = usedBudgetBeforeRam;
    const ramBudget = budgetUsd - coreUsed
    const ramResult = selectRAM(ramBudget, purpose, motherboardResult.motherboard)
    if (ramResult?.error) { finalNumber--; downgraded = true; attempts++; continue }

    const storageBudget = budgetUsd - coreUsed - Number(ramResult?.ram?.Price ?? 0)
    const storageResult = selectStorageAuto(storageBudget, purpose, tierText)
    if (storageResult?.error) { finalNumber--; downgraded = true; attempts++; continue }

    const usedBudget = Number(gpu.Price) + Number(cpu.Price) + Number(psuResult?.psu?.Price ?? 0) + Number(motherboardResult?.motherboard?.Price ?? 0) + Number(ramResult?.ram?.Price ?? 0) + Number(storageResult?.storage?.Price ?? 0)
    if (usedBudget > budgetUsd + 50 ) { finalNumber--; downgraded = true; attempts++; continue }

    // SUCCESS RETURN
    return {
      gpuResult: { gpu, FinalGPU_Text: tierText, FinalGPU_Number: finalNumber, GPU_Adjusted: downgraded ? "Yes" : "No", GPU_Budget: gpuBudget, GPU_Percent: gpuBudgetPercent(purpose, tierText), attempts },
      cpuResult: { cpu, CPU_Budget: cpuBudget, CPU_Percent: cpuBudgetPercent(purpose), CPU_Required_Level_Text: requiredText, CPU_Required_Level_Number: requiredLevel },
      psuResult, motherboardResult, ramResult, storageResult,
      // --- FIX: Pass the calculated value instead of null ---
      recommendedNormalBudget: recommendedNormalBudget, 
      recommendedMinimumBudget: recommendedMinimumBudget
    }
  }

  // FAIL STATE HANDLING
  if (!includeRecommendations) {
    return { error: `No build fits within budget for ${purpose}.`, attempts, minimumAllowedTier: minimumTier, lastAttempt }
  }

  const budgetGap = recommendedMinimumBudget !== null ? Math.max(0, recommendedMinimumBudget - budgetUsd) : null

  // Only return the minimum build if the user can actually afford it OR if we are just calculating recommendations
if (minimumBuild && budgetUsd >= minimumBuild.total) {
    const fallbackResult = convertMinimumBuildToBuildResult(minimumBuild, purpose, minimumTier)
    return { ...fallbackResult, recommendedNormalBudget, recommendedMinimumBudget }
}
  
  return {
    error: recommendedMinimumBudget !== null
      ? recommendedNormalBudget !== null && recommendedNormalBudget > recommendedMinimumBudget
        ? `No normal ${minimumTier} ${purpose} build fits within $${budgetUsd}. Minimum: $${recommendedMinimumBudget}. Recommended: $${recommendedNormalBudget}.`
        : `No ${minimumTier} ${purpose} build fits within $${budgetUsd}. Minimum: $${recommendedMinimumBudget}.`
      : `No build fits within budget for ${purpose}.`,
    attempts, minimumAllowedTier: minimumTier, recommendedMinimumBudget, recommendedNormalBudget, budgetGap, lastAttempt, minimumBuild
  }
}
// ======================================================
// 14. BUILD CONFIDENCE REPORT
// ======================================================

function buildConfidenceReport(buildResult: any) {
  const gpu = buildResult?.gpuResult?.gpu
  const cpu = buildResult?.cpuResult?.cpu
  const psu = buildResult?.psuResult?.psu
  const motherboard = buildResult?.motherboardResult?.motherboard

  if (!gpu || !cpu || !psu || !motherboard) return null

  const requiredCpuLevel = Number(buildResult?.cpuResult?.CPU_Required_Level_Number ?? cpuLevelTextToNumber(String(gpu?.["Required CPU Level"] ?? "Medium")))
  const selectedCpuLevel = Number(cpu?.CPU_Level_Number ?? 0)
  const requiredPsuWattage = Number(buildResult?.psuResult?.PSU_Required_Wattage ?? calculateRequiredPSU(gpu))
  const required8Pin = Number(buildResult?.psuResult?.PSU_Required_8Pin ?? gpu?.["PCIe 8pin Required"] ?? 0)
  const selectedPsuWattage = Number(psu?.Wattage ?? 0)
  const selectedPsu8Pin = Number(psu?.pcie_8pin_count ?? 0)
  const motherboardTier = String(motherboard?.Tier ?? "")
  const maxRam = Number(motherboard?.MaxRam_GB ?? 0)
  const m2Slots = Number(motherboard?.["M2 Slots"] ?? 0)

  const noBottleneck = selectedCpuLevel >= requiredCpuLevel
  const powerSufficient = selectedPsuWattage >= requiredPsuWattage && selectedPsu8Pin >= required8Pin
  const upgradePath = motherboardTier === "Mid" || motherboardTier === "High" || maxRam >= 128 || m2Slots >= 2 || selectedPsuWattage > requiredPsuWattage

  let score = 0
  if (noBottleneck) score++
  if (powerSufficient) score++
  if (upgradePath) score++

  let level = "Low"
  if (score === 3) level = "High"
  else if (score === 2) level = "Medium"

  return {
    level, score,
    checks: [
      { key: "bottleneck", label: noBottleneck ? "No bottlenecks detected" : "Potential CPU bottleneck", passed: noBottleneck },
      { key: "power", label: powerSufficient ? "Power delivery sufficient" : "Power delivery may be insufficient", passed: powerSufficient },
      { key: "upgrade", label: upgradePath ? "Upgrade path available" : "Limited upgrade path", passed: upgradePath },
    ],
  }
}

// ======================================================
// 15. WORKER FETCH HANDLER (WITH VALIDATION)
// ======================================================

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // --- CORS ---
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders() })
        }

        if (request.method !== "POST") {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Only POST method is allowed.",
                }),
                { status: 405, headers: corsHeaders() }
            )
        }

        // --- RATE LIMITING ---
        const clientIP =
            request.headers.get("CF-Connecting-IP") ||
            request.headers.get("X-Forwarded-For") ||
            "unknown"

        // Cleanup stale entries every request (lightweight)
        cleanupRateLimitMap()

        if (!checkRateLimit(clientIP)) {
            return rateLimitResponse()
        }

        // --- PARSE BODY ---
        let body: any = {}
        try {
            const rawText = await request.text()

            // Check body size (prevent huge payloads)
            if (rawText.length > 50_000) {
                return new Response(
                    JSON.stringify({
                        status: "error",
                        message: "Request body too large (max 50KB).",
                    }),
                    { status: 413, headers: corsHeaders() }
                )
            }

            body = JSON.parse(rawText)
        } catch {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message:
                        "Invalid JSON body. Send a valid JSON object.",
                }),
                { status: 400, headers: corsHeaders() }
            )
        }

        // ============================================
        // 🛡️ VALIDATION GATE
        // ============================================

        const validation = validateRequestBody(body)

        if (!validation.valid) {
            console.warn(
                `Validation failed for ${clientIP}:`,
                validation.errors
            )
            return validationErrorResponse(validation.errors)
        }

        // Use sanitized data from here on
        const safe = validation.sanitized

        // ============================================
        // CONTINUE WITH VALIDATED + SANITIZED DATA
        // ============================================

        const chatHistory = safe.history || []
        const isExperiencedMode = safe.mode === "experienced"
        const pendingSuggestion = safe.pending_suggestion

        let budget = 0
        let purpose = ""
        let userText = ""
        let extracted: any = null
        let tier: TierText = "Entry"

        // SETUP MODE
        if (isExperiencedMode) {
            let rawBudget = safe.budget || 0
            const newBudget = detectBudgetIntent(
                safe.inputs || "",
                rawBudget,
                pendingSuggestion
            )
            budget = newBudget ? newBudget : rawBudget
            purpose = safe.purpose || "Gaming"
            userText = `Custom Build: ${safe.cpu} + ${safe.gpu}`
            extracted = {
                budget_usd: String(budget),
                purpose,
                performance_tier: "Manual",
            }
        } else {
            // AUTO MODE: Extract via AI
            const extractionPrompt = buildPrompt(safe.inputs)

            try {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 6000)

                const extractRes = await fetch(HF_URL, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${env.HF_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: MODEL,
                        messages: [
                            { role: "user", content: extractionPrompt },
                        ],
                        temperature: 0.1,
                        max_tokens: 200,
                    }),
                    signal: controller.signal,
                })

                clearTimeout(timeoutId)

                if (!extractRes.ok) throw new Error("HF extraction failed")

                const extractJson: any = await extractRes.json()
                const rawContent =
                    extractJson?.choices?.[0]?.message?.content ?? ""
                extracted = extractJsonObject(rawContent)

                if (!extracted) {
                    return new Response(
                        JSON.stringify({
                            status: "error",
                            message:
                                "Could not understand your request. Try rephrasing — e.g. 'Gaming PC for $900'.",
                            raw_ai_response: rawContent,
                        }),
                        { status: 422, headers: corsHeaders() }
                    )
                }

                budget = sanitizeNumber(extracted.budget_usd, 800)
                purpose = extracted.purpose || "Gaming"
                tier = (extracted.performance_tier as TierText) || "Entry"

                // Post-extraction validation
                if (budget < MIN_BUDGET) budget = MIN_BUDGET
                if (budget > MAX_BUDGET) budget = MAX_BUDGET
                if (!VALID_PURPOSES.includes(purpose)) purpose = "Gaming"
                if (!VALID_TIERS.includes(tier)) tier = "Entry"
            } catch (e) {
                // Extraction timeout — use defaults from input
                const budgetMatch = safe.inputs.match(/\$(\d+)/)
                budget = budgetMatch
                    ? Math.max(
                          MIN_BUDGET,
                          Math.min(MAX_BUDGET, Number(budgetMatch[1]))
                      )
                    : 800
                purpose = "Gaming"
                tier = "Entry"
                extracted = {
                    budget_usd: String(budget),
                    purpose,
                    performance_tier: tier,
                    _fallback: true,
                }
            }
        }

        // BUILD SELECTION
        let buildResult: any
        if (isExperiencedMode) {
            buildResult = selectExperiencedBuild(
                budget,
                purpose,
                safe.cpu || "",
                safe.gpu || ""
            )
        } else {
            buildResult = selectCoreBuild(budget, purpose, tier, 2)
        }

        if (buildResult?.error && !isExperiencedMode) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    extracted,
                    build: null,
                    remainingBudget: 0,
                    buildMode: "failed",
                    recommendedNormalBudget:
                        buildResult.recommendedNormalBudget ?? null,
                    recommendedMinimumBudget:
                        buildResult.recommendedMinimumBudget ?? null,
                    upgradeSuggestion: buildResult.error,
                    confidenceReport: null,
                    raw_input: safe.inputs || "",
                    chat_response: buildResult.error,
                    suggested_budget:
                        buildResult.recommendedMinimumBudget ?? null,
                }),
                { status: 400, headers: corsHeaders() }
            )
        }

        // DATA PREP
        const finalCpu = buildResult.cpuResult?.cpu
        const finalGpu = buildResult.gpuResult?.gpu
        const missingParts =
            buildResult.error ||
            !finalGpu ||
            !finalCpu ||
            !buildResult.motherboardResult?.motherboard ||
            !buildResult.psuResult?.psu ||
            !buildResult.ramResult?.ram ||
            !buildResult.storageResult?.storage

        const realTotalCost = buildResult.estimatedTotal
            ? buildResult.estimatedTotal
            : Number(finalCpu?.Price || 0) +
              Number(finalGpu?.Price || 0) +
              Number(
                  buildResult.motherboardResult?.motherboard?.Price || 0
              ) +
              Number(buildResult.ramResult?.ram?.Price || 0) +
              Number(buildResult.psuResult?.psu?.Price || 0) +
              Number(buildResult.storageResult?.storage?.Price || 0)

                // FIX: SAFE SUGGESTION LOGIC
        let nextSuggestion: number | null = null;

        // 1. If we have a calculated recommendation from the build engine, use that (Most Accurate)
        if (buildResult?.recommendedMinimumBudget) {
             nextSuggestion = buildResult.recommendedMinimumBudget;
        }
        // 2. If not, try to estimate based on the parts we found
        else if (missingParts) {
            nextSuggestion = Math.ceil(realTotalCost / 50) * 50 + 50;
        }

        // 3. Failsafe: If suggestion is still lower than current budget, force it higher
        if (nextSuggestion !== null && nextSuggestion <= budget) {
            nextSuggestion = budget + 200;
        }
        
        // 4. Default if all else fails
        if (missingParts && !nextSuggestion) {
            nextSuggestion = budget + 250;
        }

        const fullBuildData = {
            cpu: finalCpu,
            gpu: finalGpu,
            ram: buildResult.ramResult?.ram || null,
            motherboard:
                buildResult.motherboardResult?.motherboard || null,
            storage: buildResult.storageResult?.storage || null,
            psu: buildResult.psuResult?.psu || null,
            totalCost: Math.ceil(realTotalCost),
        }

        // CONFIDENCE REPORT
        const confidence = buildConfidenceReport(buildResult)

        const budgetWasOverridden = budget !== Number(safe.budget)

        
        const budgetIssues = {
            userBudget: budget,
            actualCost: fullBuildData.totalCost,
            missingParts,
            wasAdjusted: buildResult.budgetWasAdjusted || false,
            budgetWasOverridden,
            suggestedBudget: nextSuggestion,
        }

        const buildMode = isExperiencedMode
            ? "experienced"
            : buildResult.minimumBuildUsed
            ? "minimum-fallback"
            : "normal"

        const remainingBudget = Math.max(
            0,
            budget - fullBuildData.totalCost
        )

        const recommendedNormalBudget =
            buildResult.recommendedNormalBudget ?? null

        let upgradeSuggestion: string | null = null
        if (
            !missingParts &&
            recommendedNormalBudget &&
            recommendedNormalBudget > budget
        ) {
            upgradeSuggestion = `This build works at your budget, but increasing to $${recommendedNormalBudget} would unlock a better-balanced build.`
        } else if (!missingParts && remainingBudget > 100) {
            upgradeSuggestion = `You have $${remainingBudget} remaining — consider upgrading RAM or storage.`
        }

        const rawInput = safe.inputs || userText || ""

// CHANGE: If build is successful, use recommendedNormalBudget as a suggestion for an upgrade
if (!missingParts && recommendedNormalBudget && recommendedNormalBudget > budget) {
    nextSuggestion = recommendedNormalBudget;
}


        // CHAT WITH TIMEOUT + ANALYSIS
        const chatPrompt = buildChatSummaryPrompt(
            safe.inputs || userText,
            purpose,
            fullBuildData,
            budgetIssues,
            chatHistory,
            confidence
        )

        let chatResponseText = ""

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(
                () => controller.abort(),
                8000
            )

            const chatRes = await fetch(HF_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.HF_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: [
                        { role: "user", content: chatPrompt },
                    ],
                    temperature: 0.7,
                    max_tokens: 800,
                }),
                signal: controller.signal,
            })

            clearTimeout(timeoutId)
            if (!chatRes.ok) throw new Error("HF API Error")
            const chatJson: any = await chatRes.json()
            chatResponseText =
                chatJson?.choices?.[0]?.message?.content ?? ""
        } catch (e) {
            // FALLBACK
            if (missingParts) {
                chatResponseText = `⏳ Connection timeout.\nWe selected **${finalCpu?.Name}** + **${finalGpu?.Name}**, but the $${budget} budget doesn't cover all support parts.\nPlease increase to **$${nextSuggestion}** to complete this build.`
            } else {
                const psuW = Number(fullBuildData.psu?.Wattage ?? 0)
                const reqW = Number(
                    finalGpu?.["MinPSU_Wattage"] ?? 0
                )
                const moboMax = Number(
                    fullBuildData.motherboard?.MaxRam_GB ?? 0
                )
                const ramGb = Number(
                    fullBuildData.ram?.CapacityGB ?? 0
                )
                const m2 = Number(
                    fullBuildData.motherboard?.["M2 Slots"] ?? 0
                )

                chatResponseText = `⏳ AI timed out – here's your build with manual analysis:

**Build List:**
• CPU: ${finalCpu?.Name} – $${finalCpu?.Price}
• GPU: ${finalGpu?.Name} – $${finalGpu?.Price}
• RAM: ${fullBuildData.ram?.Name} – $${fullBuildData.ram?.Price}
• Motherboard: ${fullBuildData.motherboard?.Name} – $${fullBuildData.motherboard?.Price}
• Storage: ${fullBuildData.storage?.Name} – $${fullBuildData.storage?.Price}
• PSU: ${fullBuildData.psu?.Name} – $${fullBuildData.psu?.Price}
• **Total: $${fullBuildData.totalCost}**

**Compatibility:** ${confidence?.level ?? "Unknown"} confidence – ${confidence?.checks?.filter((c: any) => c.passed).length ?? 0}/3 checks passed.

**Upgrade Path:**
${ramGb < moboMax ? `• RAM upgradable to ${moboMax}GB` : "• RAM at max capacity"}
${m2 > 1 ? `• ${m2} M.2 slots – add more NVMe storage` : "• 1 M.2 slot – use SATA for expansion"}
${psuW - reqW > 50 ? `• PSU has ${psuW - reqW}W headroom for GPU upgrades` : "• PSU is tight – upgrade PSU alongside GPU"}`
            }
        }

        // RETURN
        return new Response(
            JSON.stringify({
                status: "ok",
                extracted,
                build: fullBuildData,
                remainingBudget,
                buildMode,
                recommendedNormalBudget,
                upgradeSuggestion,
                confidenceReport: confidence,
                raw_input: rawInput,
                chat_response: chatResponseText,
                updated_budget: budgetWasOverridden ? budget : null,
                suggested_budget: nextSuggestion,
            }),
            { status: 200, headers: corsHeaders() }
        )
    },
}
