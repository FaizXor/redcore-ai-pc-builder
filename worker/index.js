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
    "Gaming": { Entry: 0.32, Mid: 0.40, High: 0.45 },
    "Competitive Gaming": { Entry: 0.38, Mid: 0.45, High: 0.50 },
    "Content Creation": { Entry: 0.22, Mid: 0.25, High: 0.30 },
    "Streaming": { Entry: 0.28, Mid: 0.32, High: 0.35 },
    "Office/School": { Entry: 0.10, Mid: 0.15, High: 0.18 },
  }

  return table[purpose]?.[tier] ?? 0.25
}

function cpuBudgetPercent(purpose: string): number {
  const table: Record<string, number> = {
    "Gaming": 0.22,
    "Competitive Gaming": 0.28,
    "Content Creation": 0.32,
    "Streaming": 0.30,
    "Office/School": 0.18,
  }

  return table[purpose] ?? 0.22
}

function psuBudgetPercent(purpose: string, gpuTier: TierText): number {
  const table: Record<string, Record<TierText, number>> = {
    "Gaming": {
      Entry: 0.08,
      Mid: 0.12,
      High: 0.14
    },
    "Competitive Gaming": {
      Entry: 0.08,
      Mid: 0.14,
      High: 0.16
    },
    "Content Creation": {
      Entry: 0.10,
      Mid: 0.14,
      High: 0.16
    },
    "Streaming": {
      Entry: 0.10,
      Mid: 0.14,
      High: 0.16
    },
    "Office/School": {
      Entry: 0.06,
      Mid: 0.08,
      High: 0.10
    }
  }

  return table[purpose]?.[gpuTier] ?? 0.10
}


function motherboardBudgetPercent(gpuTier: TierText): number {
  const table: Record<TierText, number> = {
    "Entry": 0.12,
    "Mid": 0.18,
    "High": 0.20
  }

  return table[gpuTier] ?? 0.14
}

function ramBudgetPercent(purpose: string): number {
  const table: Record<string, number> = {
    "Gaming": 0.12,
    "Competitive Gaming": 0.12,
    "Content Creation": 0.18,
    "Streaming": 0.16,
    "Office/School": 0.08,
  }

  return table[purpose] ?? 0.12
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
  const candidates = GPUS
    .filter((g: any) => g.Tier === tier && Number(g.Price) <= budget)
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))

  return candidates[0] ?? null
}

function findBestCPU(requiredLevel: number, cpuBudget: number, socket = "AM4") {
  const candidates = CPUS
    .filter((c: any) =>
      (socket ? String(c.Socket).toUpperCase() === socket : true) &&
      Number(c.CPU_Level_Number) >= requiredLevel &&
      Number(c.Price) <= cpuBudget
    )
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

function findBestPSU(requiredWattage: number, required8Pin: number, psuBudget: number) {
  const candidates = PSUS
    .filter((p: any) =>
      Number(p.Wattage) >= requiredWattage &&
      Number(p.pcie_8pin_count) >= required8Pin &&
      Number(p.Price) <= psuBudget
    )
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

function findBestMotherboard(socket: string, ramType: string, gpuTier: TierText, budget: number) {
  const candidates = MOTHERBOARDS
    .filter((m: any) =>
      String(m.Socket).toUpperCase() === socket &&
      String(m.RAMType).toUpperCase() === ramType &&
      String(m.Tier) === gpuTier &&
      Number(m.Price) <= budget
    )
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))

  return candidates[0] ?? null
}

function findBestRAM(ramType: string, capacityGb: number, budget: number) {
  const candidates = RAMS
    .filter((r: any) =>
      String(r.DDRType).toUpperCase() === ramType &&
      Number(r.CapacityGB) === capacityGb &&
      Number(r.Price) <= budget
    )
    .sort((a: any, b: any) => Number(b.SpeedMhz) - Number(a.SpeedMhz))

  return candidates[0] ?? null
}

function getLowestRamPrice(ramType: string): number {
  const candidates = RAMS
    .filter((r: any) =>
      String(r.DDRType).toUpperCase() === ramType
    )
    .map((r: any) => Number(r.Price))
    .filter((price: number) => !Number.isNaN(price))

  if (candidates.length === 0) return 0

  return Math.min(...candidates)
}

function getLowestStoragePrice(): number {
  const candidates = STORAGE
    .map((s: any) => Number(s.Price))
    .filter((price: number) => !Number.isNaN(price))

  if (candidates.length === 0) return 0

  return Math.min(...candidates)
}

function findBestStorage(tier: TierText, budget: number) {
  const candidates = STORAGE
    .filter((s: any) =>
      String(s.Tier) === tier &&
      Number(s.Price) <= budget
    )
    .sort((a: any, b: any) => Number(b.Capacity) - Number(a.Capacity))

  return candidates[0] ?? null
}

function findCheapestGPU(tier: TierText) {
  const candidates = GPUS
    .filter((g: any) => String(g.Tier) === tier)
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

function findCheapestCPU(requiredLevel: number, socket = "AM4") {
  const candidates = CPUS
    .filter((c: any) =>
      (socket ? String(c.Socket).toUpperCase() === socket : true) &&
      Number(c.CPU_Level_Number) >= requiredLevel
    )
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

function findCheapestPSU(requiredWattage: number, required8Pin: number) {
  const candidates = PSUS
    .filter((p: any) =>
      Number(p.Wattage) >= requiredWattage &&
      Number(p.pcie_8pin_count) >= required8Pin
    )
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

function findCheapestMotherboard(socket: string, ramType: string, gpuTier: TierText) {
  const candidates = MOTHERBOARDS
    .filter((m: any) =>
      String(m.Socket).toUpperCase() === socket &&
      String(m.RAMType).toUpperCase() === ramType &&
      String(m.Tier) === gpuTier
    )
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

function findCheapestRAM(ramType: string, capacityGb: number) {
  const candidates = RAMS
    .filter((r: any) =>
      String(r.DDRType).toUpperCase() === ramType &&
      Number(r.CapacityGB) === capacityGb
    )
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

function findCheapestStorage(tier: TierText) {
  const candidates = STORAGE
    .filter((s: any) => String(s.Tier) === tier)
    .sort((a: any, b: any) => Number(a.Price) - Number(b.Price))

  return candidates[0] ?? null
}

// ======================================================
// 9. PSU SELECTOR
// ======================================================

function selectPSU(budgetUsd: number, purpose: string, gpu: any, gpuTier: TierText) {
  const psuBudget = Math.round(budgetUsd * psuBudgetPercent(purpose, gpuTier))
  const requiredWattage = calculateRequiredPSU(gpu)
  const required8Pin = Number(gpu?.["PCIe 8pin Required"] ?? 0)

  const psu = findBestPSU(requiredWattage, required8Pin, psuBudget)

  if (!psu) {
    return {
      error: "No PSU found within budget that satisfies wattage and connector requirements.",
      PSU_Budget: psuBudget,
      PSU_Required_Wattage: requiredWattage,
      PSU_Required_8Pin: required8Pin,
    }
  }

  return {
    psu,
    PSU_Budget: psuBudget,
    PSU_Percent: psuBudgetPercent(purpose, gpuTier),
    PSU_Required_Wattage: requiredWattage,
    PSU_Required_8Pin: required8Pin,
  }
}
// ======================================================
// 9. Motherboard SELECTOR
// ======================================================

function selectMotherboard(budgetUsd: number, gpuTier: TierText, cpu: any) {
  const mbBudget = Math.round(budgetUsd * motherboardBudgetPercent(gpuTier))

  const socket = String(cpu?.Socket ?? "").toUpperCase()
  const ramType = String(cpu?.["Supported RAM Type"] ?? "DDR4").toUpperCase()

  const motherboard = findBestMotherboard(socket, ramType, gpuTier, mbBudget)

  if (!motherboard) {
    return {
      error: "No motherboard found compatible with the selected CPU and RAM type.",
      MB_Budget: mbBudget,
      MB_Required_Socket: socket,
      MB_Required_RAMType: ramType,
      MB_Required_Tier: gpuTier
    }
  }

  return {
    motherboard,
    MB_Budget: mbBudget,
    MB_Percent: motherboardBudgetPercent(gpuTier)
  }
}

// ======================================================
// 12. RAM SELECTOR
// ======================================================

function selectRAM(ramBudget: number, purpose: string, motherboard: any) {
  const ramType = String(motherboard?.RAMType ?? "DDR4").toUpperCase()
  const preferredRamGb = getPreferredRamGb(purpose)

  let ram = findBestRAM(ramType, preferredRamGb, ramBudget)

  if (ram) {
    return {
      ram,
      RAM_Budget: ramBudget,
      RAM_Preferred_GB: preferredRamGb,
      RAM_Adjusted: "No"
    }
  }

  if (preferredRamGb === 32) {
    ram = findBestRAM(ramType, 16, ramBudget)

    if (ram) {
      return {
        ram,
        RAM_Budget: ramBudget,
        RAM_Preferred_GB: preferredRamGb,
        RAM_Adjusted: "Yes",
        RAM_Adjustment_Message:
          "Preferred 32GB RAM was not available within budget, so the system selected 16GB."
      }
    }
  }

  return {
    error: "No RAM kit found within budget for the required RAM type.",
    RAM_Budget: ramBudget,
    RAM_Type: ramType,
    RAM_Preferred_GB: preferredRamGb
  }
}

// ======================================================
// 13. STORAGE SELECTOR
// ======================================================

function selectStorage(storageBudget: number, purpose: string, gpuTier: TierText) {
  const baseTierNumber = tierTextToNumber(gpuTier)
  const storageShift = getStorageShift(purpose)

  let targetTierNumber = clamp(baseTierNumber + storageShift, 1, 3)

  while (targetTierNumber >= 1) {
    const targetTierText = numberToTierText(targetTierNumber)
    const storage = findBestStorage(targetTierText, storageBudget)

    if (storage) {
      return {
        storage,
        Storage_Budget: storageBudget,
        Storage_Final_Tier: targetTierText,
        Storage_Adjusted:
          targetTierNumber !== baseTierNumber + storageShift ? "Yes" : "No"
      }
    }

    targetTierNumber--
  }

  return {
    error: "No storage option found within budget.",
    Storage_Budget: storageBudget
  }
}

// ======================================================
// 14. MINIMUM REQUIRED BUDGET CALCULATOR
// ======================================================

function calculateMinimumRequiredBudget(purpose: string, minimumTier: TierText) {
  // 1) Cheapest valid GPU for minimum allowed tier
  const gpu = findCheapestGPU(minimumTier)
  if (!gpu) return null

  // 2) Cheapest valid CPU for that GPU
  const requiredCpuText = String(gpu?.["Required CPU Level"] ?? "Medium")
  const requiredCpuLevel = cpuLevelTextToNumber(requiredCpuText)

  const cpu = findCheapestCPU(requiredCpuLevel, "AM4")
  if (!cpu) return null

  // 3) Cheapest valid PSU
  const requiredPsuWattage = calculateRequiredPSU(gpu)
  const required8Pin = Number(gpu?.["PCIe 8pin Required"] ?? 0)

  const psu = findCheapestPSU(requiredPsuWattage, required8Pin)
  if (!psu) return null

  // 4) Cheapest valid motherboard
  const socket = String(cpu?.Socket ?? "").toUpperCase()
  const ramType = String(cpu?.["Supported RAM Type"] ?? "DDR4").toUpperCase()

  const motherboard = findCheapestMotherboard(socket, ramType, minimumTier)
  if (!motherboard) return null

  // 5) Cheapest valid RAM
  const preferredRamGb = getPreferredRamGb(purpose)

  let ram = findCheapestRAM(ramType, preferredRamGb)

  // local RAM fallback: 32 -> 16
  if (!ram && preferredRamGb === 32) {
    ram = findCheapestRAM(ramType, 16)
  }

  if (!ram) return null

  // 6) Cheapest valid storage
  const storageShift = getStorageShift(purpose)
  let storageTierNumber = clamp(tierTextToNumber(minimumTier) + storageShift, 1, 3)

  let storage = null

  while (storageTierNumber >= 1) {
    const storageTierText = numberToTierText(storageTierNumber)
    storage = findCheapestStorage(storageTierText)

    if (storage) break
    storageTierNumber--
  }

  if (!storage) return null

  const total =
    Number(gpu.Price) +
    Number(cpu.Price) +
    Number(psu.Price) +
    Number(motherboard.Price) +
    Number(ram.Price) +
    Number(storage.Price)

  return {
    total: Math.ceil(total),
    gpu,
    cpu,
    psu,
    motherboard,
    ram,
    storage
  }
}

function calculateRecommendedNormalBudget(
  purpose: string,
  performanceTier: TierText,
  startBudget: number,
  maxBudget = 3000
) {
  let testBudget = startBudget

  while (testBudget <= maxBudget) {
    const testResult = selectCoreBuild(testBudget, purpose, performanceTier, 2, false)

    if (!testResult?.error) {
      return testBudget
    }

    testBudget += 5
  }

  return null
}

function convertMinimumBuildToBuildResult(minimumBuild: any, purpose: string, minimumTier: TierText) {
  if (!minimumBuild) return null

  const gpu = minimumBuild.gpu
  const cpu = minimumBuild.cpu
  const psu = minimumBuild.psu
  const motherboard = minimumBuild.motherboard
  const ram = minimumBuild.ram
  const storage = minimumBuild.storage

  const requiredText = String(gpu?.["Required CPU Level"] ?? "Medium")
  const requiredLevel = cpuLevelTextToNumber(requiredText)

  return {
    gpuResult: {
      gpu,
      FinalGPU_Text: minimumTier,
      FinalGPU_Number: tierTextToNumber(minimumTier),
      GPU_Adjusted: "No",
      GPU_Budget: Number(gpu?.Price ?? 0),
      GPU_Percent: null,
      attempts: 0,
      Build_Mode: "Minimum"
    },
    cpuResult: {
      cpu,
      CPU_Budget: Number(cpu?.Price ?? 0),
      CPU_Percent: null,
      CPU_Required_Level_Text: requiredText,
      CPU_Required_Level_Number: requiredLevel,
      Build_Mode: "Minimum"
    },
    psuResult: {
      psu,
      PSU_Budget: Number(psu?.Price ?? 0),
      PSU_Percent: null,
      PSU_Required_Wattage: Number(gpu?.["MinPSU_Wattage"] ?? 0),
      PSU_Required_8Pin: Number(gpu?.["PCIe 8pin Required"] ?? 0),
      Build_Mode: "Minimum"
    },
    motherboardResult: {
      motherboard,
      MB_Budget: Number(motherboard?.Price ?? 0),
      MB_Percent: null,
      Build_Mode: "Minimum"
    },
    ramResult: {
      ram,
      RAM_Budget: Number(ram?.Price ?? 0),
      RAM_Preferred_GB: getPreferredRamGb(purpose),
      RAM_Adjusted:
        Number(ram?.CapacityGB ?? 0) < Number(getPreferredRamGb(purpose))
          ? "Yes"
          : "No",
      Build_Mode: "Minimum"
    },
    storageResult: {
      storage,
      Storage_Budget: Number(storage?.Price ?? 0),
      Storage_Final_Tier: storage?.Tier ?? null,
      Storage_Adjusted: "No",
      Build_Mode: "Minimum"
    },
    minimumBuildUsed: true,
    minimumBuildTotal: minimumBuild.total
  }
}

// ======================================================
// 10. MAIN GPU+CPU+PSU BUILD LOOP
// ======================================================
// This is your NEW downgrade engine.
// It replaces the old separate GPU and CPU retry logic.
//
// Logic:
// 1. Start from AI tier
// 2. Apply purpose GPU shift
// 3. Try GPU
// 4. Try CPU for that GPU
// 5. Try PSU for that GPU
// 6. If GPU or CPU fails -> lower GPU tier and retry
// 7. If PSU fails -> stop with PSU error
// ======================================================

function selectCoreBuild(
  budgetUsd: number,
  purpose: string,
  performanceTier: TierText,
  maxRetries = 2,
  includeRecommendations = true
) {
  const baseNumber = tierTextToNumber(performanceTier)
  const shift = getGpuShift(purpose)

const minimumTier = minimumGpuTierForPurpose(purpose)
const minimumTierNumber = tierTextToNumber(minimumTier)

  let finalNumber = clamp(baseNumber + shift, 1, 3)
  let downgraded = false
  let attempts = 0
  let lastAttempt: any = null

  while (finalNumber >= minimumTierNumber && attempts <= maxRetries) {
    const tierText = numberToTierText(finalNumber)

    // ---------------- GPU ----------------
    const gpuBudget = Math.round(budgetUsd * gpuBudgetPercent(purpose, tierText))
    const gpu = findBestGPU(tierText, gpuBudget)

    if (!gpu) {
      finalNumber--
      downgraded = true
      attempts++
      continue
    }

    // ---------------- CPU ----------------
    const cpuBudget = Math.round(budgetUsd * cpuBudgetPercent(purpose))
    const requiredText = String(gpu?.["Required CPU Level"] ?? "Medium")
    const requiredLevel = cpuLevelTextToNumber(requiredText)

    const cpu = findBestCPU(requiredLevel, cpuBudget, "AM4")

    if (!cpu) {
      finalNumber--
      downgraded = true
      attempts++
      continue
    }

    // ---------------- PSU ----------------
    const psuResult = selectPSU(budgetUsd, purpose, gpu, tierText)

if (psuResult?.error) {
  finalNumber--
  downgraded = true
  attempts++
  continue
}

    // ---------------- Motherboard ----------------

    const motherboardResult = selectMotherboard(budgetUsd, tierText, cpu)

if (motherboardResult?.error) {
  finalNumber--
  downgraded = true
  attempts++
  continue
}

const ramType = String(motherboardResult?.motherboard?.RAMType ?? "DDR4").toUpperCase()
const minimumRamReserve = getLowestRamPrice(ramType)

const usedBudgetBeforeRam =
  Number(gpu.Price) +
  Number(cpu.Price) +
  Number(psuResult?.psu?.Price ?? 0) +
  Number(motherboardResult?.motherboard?.Price ?? 0)

if (usedBudgetBeforeRam > budgetUsd - minimumRamReserve) {
  lastAttempt = {
    gpuResult: {
      gpu,
      FinalGPU_Text: tierText,
      FinalGPU_Number: finalNumber,
      GPU_Budget: gpuBudget,
      GPU_Price: Number(gpu.Price)
    },
    cpuResult: {
      cpu,
      CPU_Budget: cpuBudget,
      CPU_Price: Number(cpu.Price)
    },
    psuResult,
    motherboardResult,
    minimumRamReserve
  }

  finalNumber--
  downgraded = true
  attempts++
  continue
}

const coreUsed =
  Number(gpu.Price) +
  Number(cpu.Price) +
  Number(psuResult?.psu?.Price ?? 0) +
  Number(motherboardResult?.motherboard?.Price ?? 0)

// ---------------- RAM ----------------
const ramBudget = budgetUsd - coreUsed
const ramResult = selectRAM(ramBudget, purpose, motherboardResult.motherboard)

if (ramResult?.error) {
  lastAttempt = {
    gpuResult: {
      gpu,
      FinalGPU_Text: tierText,
      FinalGPU_Number: finalNumber,
      GPU_Budget: gpuBudget,
      GPU_Price: Number(gpu.Price)
    },
    cpuResult: {
      cpu,
      CPU_Budget: cpuBudget,
      CPU_Price: Number(cpu.Price)
    },
    psuResult,
    motherboardResult,
    minimumRamReserve
  }

  finalNumber--
  downgraded = true
  attempts++
  continue
}

// ---------------- STORAGE ----------------
const storageBudget = budgetUsd - coreUsed - Number(ramResult?.ram?.Price ?? 0)
const storageResult = selectStorage(storageBudget, purpose, tierText)

if (storageResult?.error) {
  lastAttempt = {
    gpuResult: {
      gpu,
      FinalGPU_Text: tierText,
      FinalGPU_Number: finalNumber,
      GPU_Budget: gpuBudget,
      GPU_Price: Number(gpu.Price)
    },
    cpuResult: {
      cpu,
      CPU_Budget: cpuBudget,
      CPU_Price: Number(cpu.Price)
    },
    psuResult,
    motherboardResult,
    ramResult,
    minimumRamReserve,
    minimumStorageReserve: getLowestStoragePrice()
  }

  finalNumber--
  downgraded = true
  attempts++
  continue
}


    // ---------------- TOTAL BUDGET VALIDATION ----------------
  const usedBudget =
  Number(gpu.Price) +
  Number(cpu.Price) +
  Number(psuResult?.psu?.Price ?? 0) +
  Number(motherboardResult?.motherboard?.Price ?? 0) +
  Number(ramResult?.ram?.Price ?? 0) +
  Number(storageResult?.storage?.Price ?? 0)

    // If build is too expensive, downgrade GPU tier and retry whole build
    if (usedBudget > budgetUsd) {
      finalNumber--
      downgraded = true
      attempts++
      continue
    }

    // ---------------- SUCCESS ----------------
    return {
      gpuResult: {
        gpu,
        FinalGPU_Text: tierText,
        FinalGPU_Number: finalNumber,
        GPU_Adjusted: downgraded ? "Yes" : "No",
        GPU_Budget: gpuBudget,
        GPU_Percent: gpuBudgetPercent(purpose, tierText),
        attempts,
      },
      cpuResult: {
        cpu,
        CPU_Budget: cpuBudget,
        CPU_Percent: cpuBudgetPercent(purpose),
        CPU_Required_Level_Text: requiredText,
        CPU_Required_Level_Number: requiredLevel,
      },
      psuResult,
      motherboardResult,
      ramResult,
      storageResult,
    }
  }

if (!includeRecommendations) {
  return {
    error: `No build could fit within the budget without dropping below the minimum performance level for ${purpose}.`,
    attempts,
    minimumAllowedTier: minimumTier,
    lastAttempt
  }
}

const minimumBuild = calculateMinimumRequiredBudget(purpose, minimumTier)

const recommendedMinimumBudget = minimumBuild?.total ?? null

const recommendedNormalBudget =
  recommendedMinimumBudget !== null
    ? calculateRecommendedNormalBudget(purpose, performanceTier, recommendedMinimumBudget)
    : null

const budgetGap =
  recommendedMinimumBudget !== null
    ? Math.max(0, recommendedMinimumBudget - budgetUsd)
    : null

return {
  error:
    recommendedMinimumBudget !== null
      ? recommendedNormalBudget !== null && recommendedNormalBudget > recommendedMinimumBudget
        ? `No normal ${minimumTier} ${purpose} build fits within $${budgetUsd}. Minimum working budget: $${recommendedMinimumBudget}. Recommended budget for a better build: $${recommendedNormalBudget}.`
        : `No ${minimumTier} ${purpose} build fits within $${budgetUsd}. Recommended minimum budget: $${recommendedMinimumBudget}.`
      : `No build could fit within the budget without dropping below the minimum performance level for ${purpose}.`,
  attempts,
  minimumAllowedTier: minimumTier,
  recommendedMinimumBudget,
  recommendedNormalBudget,
  budgetGap,
  lastAttempt,
  minimumBuild
}


}

// ======================================================
// 11. WORKER FETCH HANDLER
// ======================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ---------------- CORS PREFLIGHT ----------------
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    // ---------------- ONLY POST ----------------
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        status: 405,
        headers: corsHeaders(),
      })
    }

    // ---------------- READ USER INPUT ----------------
    let userText = ""

    try {
      const body: any = await request.json()

      if (Array.isArray(body) && body[0]?.inputs) {
        userText = String(body[0].inputs)
      } else if (body?.inputs) {
        userText = String(body.inputs)
      } else {
        userText = ""
      }
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: corsHeaders(),
      })
    }

    if (!userText.trim()) {
      return new Response(JSON.stringify({ error: "Missing inputs text" }), {
        status: 400,
        headers: corsHeaders(),
      })
    }

    // ---------------- HUGGING FACE REQUEST ----------------
    const payload = {
      model: MODEL,
      messages: [{ role: "user", content: buildPrompt(userText) }],
      temperature: 0.2,
      max_tokens: 150,
    }

    console.log("HF_TOKEN present?", Boolean(env.HF_TOKEN), "length:", env.HF_TOKEN?.length)

    let hfJson: any

    try {
      const hfRes = await fetch(HF_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const raw = await hfRes.text()

      if (!hfRes.ok) {
        return new Response(
          JSON.stringify({
            error: "HF request failed",
            status: hfRes.status,
            raw,
          }),
          { status: 502, headers: corsHeaders() }
        )
      }

      hfJson = JSON.parse(raw)
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          error: "HF fetch/parse error",
          detail: String(e),
        }),
        { status: 502, headers: corsHeaders() }
      )
    }

    // ---------------- AI EXTRACTION ----------------
    const outputText = hfJson?.choices?.[0]?.message?.content ?? ""
    const extracted = extractJsonObject(outputText)

    if (!extracted) {
      return new Response(
        JSON.stringify({
          error: "Model did not return valid JSON",
          model_output: outputText,
          hf_raw: hfJson,
          raw_input: userText,
        }),
        { status: 502, headers: corsHeaders() }
      )
    }

    // ---------------- BUILD INPUTS ----------------
    const budget = Number(extracted.budget_usd) || 800
    const purpose = extracted.purpose
    const tier = extracted.performance_tier as TierText

    // ---------------- MAIN BUILD ENGINE ----------------
    let buildResult: any = selectCoreBuild(budget, purpose, tier, 2)

if (buildResult?.error) {
  const minimumTier = minimumGpuTierForPurpose(purpose)
  const minimumBuild = calculateMinimumRequiredBudget(purpose, minimumTier)

  if (minimumBuild && budget >= minimumBuild.total) {
    buildResult = convertMinimumBuildToBuildResult(minimumBuild, purpose, minimumTier)

    const recommendedNormalBudget = calculateRecommendedNormalBudget(
      purpose,
      tier,
      minimumBuild.total
    )

    buildResult.recommendedNormalBudget = recommendedNormalBudget
    buildResult.upgradeSuggestion =
      recommendedNormalBudget !== null && recommendedNormalBudget > minimumBuild.total
        ? `This build works at your budget, but increasing to $${recommendedNormalBudget} would unlock a better-balanced build.`
        : null
  }
}

    const gpuResult = buildResult?.gpuResult ?? null
    const cpuResult = buildResult?.cpuResult ?? null
    const psuResult = buildResult?.psuResult ?? null
    const motherboardResult = buildResult?.motherboardResult ?? null
    const ramResult = buildResult?.ramResult ?? null
    const storageResult = buildResult?.storageResult ?? null
    
    

    // ---------------- REMAINING BUDGET ----------------
    let remainingBudget = budget

    if (gpuResult?.gpu) {
      remainingBudget -= Number(gpuResult.gpu.Price)
    }

    if (cpuResult?.cpu) {
      remainingBudget -= Number(cpuResult.cpu.Price)
    }

    if (psuResult?.psu) {
      remainingBudget -= Number(psuResult.psu.Price)
    }

    if (motherboardResult?.motherboard) {
  remainingBudget -= Number(motherboardResult.motherboard.Price)
}

   if (ramResult?.ram) {
  remainingBudget -= Number(ramResult.ram.Price)
}


if (storageResult?.storage) {
  remainingBudget -= Number(storageResult.storage.Price)
}



    // ---------------- FINAL RESPONSE ----------------
 return new Response(
  JSON.stringify({
    status: "ok",
    extracted,
    buildResult,
    gpuResult,
    cpuResult,
    psuResult,
    motherboardResult,
    remainingBudget,
    raw_input: userText,
    ramResult,
    storageResult,
    buildMode: buildResult?.minimumBuildUsed ? "minimum-fallback" : "normal",
    recommendedNormalBudget: buildResult?.recommendedNormalBudget ?? null,
    upgradeSuggestion: buildResult?.upgradeSuggestion ?? null,
  }),
  { status: 200, headers: corsHeaders() }
)
  },
}
