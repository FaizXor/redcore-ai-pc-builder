# RedCore AI PC Builder

RedCore is a student-built web tool that helps beginners design a desktop PC using normal language.

Example input:

> "I want a gaming PC around $800 for school and esports."

The system:

1. Uses an AI model to understand the request
2. Applies real PC building rules (budget allocation and compatibility)
3. Selects appropriate hardware parts
4. Returns a complete PC build

The AI does not pick random components.
It only interprets the user’s intent — all hardware decisions are made by a rule-based configuration engine in the backend.

---

## Demo Video

https://www.youtube.com/watch?v=nRa5SJxBWAM

---

## How It Works

Frontend → Framer UI
Backend → Cloudflare Worker API
AI → HuggingFace (Qwen2.5)
Database → Local JSON hardware database (for V1)

Flow:
User text → AI extraction → rule engine → component selection → final build JSON

---

## Current Features

* Natural language PC request input
* AI extraction (budget, purpose, performance tier)
* GPU selection engine with budget allocation
* CPU matching based on GPU requirements
* Automatic downgrade safety if the budget is too low

---

## Planned Features

* RAM, motherboard, PSU and storage selection
* Conversational build editing
* Improved results page UI
* 3D PC preview

---

## Goal

The goal is to remove the fear beginners have when choosing PC parts and simulate how a real technician plans a computer build.

This is a learning project and work in progress.
