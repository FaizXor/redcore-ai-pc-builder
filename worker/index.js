import GPUS from "./data/GPUs-Grid view.json"
import CPUS from "./data/CPUs-Grid view.json"
import PURPOSE_RULES from "./data/Purpose Table-Grid view.json"


export interface Env {
  HF_TOKEN: string
}


const ALLOW_ORIGIN = "https://generic-department-250014.framer.app"
const MODEL = "Qwen/Qwen2.5-7B-Instruct"

// NEW (router endpoint)
const HF_URL = "https://router.huggingface.co/v1/chat/completions"

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

// Tries to safely pull JSON out of a model response even if it adds extra text
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

function gpuBudgetPercent(purpose: string, tier: TierText) {
  const table: any = {
    "Gaming": { Entry: 0.32, Mid: 0.40, High: 0.45 },
    "Competitive Gaming": { Entry: 0.38, Mid: 0.45, High: 0.50 },
    "Content Creation": { Entry: 0.22, Mid: 0.25, High: 0.30 },
    "Streaming": { Entry: 0.28, Mid: 0.32, High: 0.35 },
    "Office/School": { Entry: 0.10, Mid: 0.15, High: 0.18 }
  }

  return table[purpose]?.[tier] ?? 0.25
}

function cpuBudgetPercent(purpose: string): number {

  const table: Record<string, number> = {
    "Gaming": 0.25,
    "Competitive Gaming": 0.35,
    "Content Creation": 0.45,
    "Streaming": 0.40,
    "Office/School": 0.20
  }

  return table[purpose] ?? 0.25
}

function cpuLevelTextToNumber(level: string): number {
  const t = (level || "").toLowerCase()
  if (t.includes("high")) return 3
  if (t.includes("med")) return 2
  if (t.includes("low")) return 1
  return 2 // default Medium
}

function findBestGPU(tier: TierText, budget: number) {

  const candidates = GPUS
    .filter((g: any) =>
      g.Tier === tier &&
      Number(g.Price) <= budget
    )
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
    .sort((a: any, b: any) => Number(b.Price) - Number(a.Price))

  return candidates[0] ?? null
}

function selectGPU(
  budgetUsd: number,
  purpose: string,
  performanceTier: TierText,
  maxRetries = 2
) {

  const baseNumber = tierTextToNumber(performanceTier)
  const shift = getGpuShift(purpose)

  let finalNumber = clamp(baseNumber + shift, 1, 3)
  let downgraded = false
  let attempts = 0

  while (finalNumber >= 1 && attempts <= maxRetries) {

    const tierText = numberToTierText(finalNumber)

    const gpuBudget =
      Math.round(budgetUsd * gpuBudgetPercent(purpose, tierText))

    const gpu = findBestGPU(tierText, gpuBudget)

    if (gpu) {
      return {
        gpu,
        FinalGPU_Text: tierText,
        FinalGPU_Number: finalNumber,
        GPU_Adjusted: downgraded ? "Yes" : "No",
        GPU_Budget: gpuBudget,
        attempts
      }
    }

    // downgrade
    finalNumber--
    downgraded = true
    attempts++
  }

  return {
    error: "Budget too low for any compatible GPU build. Please increase your budget or type a lower performance tier.",
    attempts
  }
}

function selectCPU(
  budgetUsd: number,
  purpose: string,
  finalGpuTier: TierText,
  gpu: any,
  maxFallbacks = 2
) {
  const cpuBudget = Math.round(budgetUsd * cpuBudgetPercent(purpose))
  const requiredText = String(gpu?.["Required CPU Level"] ?? "Medium")
  let requiredLevel = cpuLevelTextToNumber(requiredText)

  let fallbackUsed = 0

  while (fallbackUsed <= maxFallbacks) {
    const cpu = findBestCPU(requiredLevel, cpuBudget, "AM4")
    if (cpu) {
      return {
        cpu,
        CPU_Budget: cpuBudget,
        CPU_Required_Level_Text: requiredText,
        CPU_Required_Level_Number: requiredLevel,
        CPU_Fallbacks_Used: fallbackUsed,
      }
    }

    // fallback: relax required CPU level by 1 step (High→Med→Low)
    requiredLevel = Math.max(1, requiredLevel - 1)
    fallbackUsed++
  }

  return {
    error: "No CPU found within budget (AM4). Increase budget or lower tier.",
    CPU_Budget: cpuBudget,
    CPU_Required_Level_Text: requiredText,
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        status: 405,
        headers: corsHeaders(),
      })
    }

    // Read incoming body
    let userText = ""
    try {
      const body: any = await request.json()
      if (Array.isArray(body) && body[0]?.inputs) userText = String(body[0].inputs)
      else if (body?.inputs) userText = String(body.inputs)
      else userText = ""
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

    // Build HF payload like your Make.com module
const payload = {
  model: MODEL,
  messages: [{ role: "user", content: buildPrompt(userText) }],
  temperature: 0.2,
  max_tokens: 150,
}

console.log("HF_TOKEN present?", Boolean(env.HF_TOKEN), "length:", env.HF_TOKEN?.length)

    // Call Hugging Face
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

      // HF sometimes returns JSON string, sometimes an array of objects depending on endpoint
      hfJson = JSON.parse(raw)
    } catch (e: any) {
      return new Response(
        JSON.stringify({ error: "HF fetch/parse error", detail: String(e) }),
        { status: 502, headers: corsHeaders() }
      )
    }

// Router chat/completions output
const outputText = hfJson?.choices?.[0]?.message?.content ?? ""

// Try parse JSON from model output
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

const budget = Number(extracted.budget_usd) || 800
const purpose = extracted.purpose
const tier = extracted.performance_tier as TierText

const gpuResult = selectGPU(budget, purpose, tier, 2)

let cpuResult: any = null

if (gpuResult?.gpu) {
  cpuResult = selectCPU(
    budget,
    purpose,
    gpuResult.FinalGPU_Text as TierText,
    gpuResult.gpu,
    2
  )
}

return new Response(
  JSON.stringify({
    status: "ok",
    extracted,
    gpuResult,
    cpuResult,
    raw_input: userText,
  }),
  { status: 200, headers: corsHeaders() }
) }
}
