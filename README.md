# RedCore AI PC Builder

RedCore is a student-built web tool that helps beginners design a compatible desktop PC using natural language.

Example input:
> "I want a gaming PC around $800 for school and esports."

The system:
1. Uses an AI model to understand the request (budget, purpose, performance tier)
2. Applies real PC-building logic (budget allocation and compatibility rules)
3. Selects appropriate hardware parts from a database
4. Returns a complete PC build with explanations

**Important:** The AI does not directly choose components.
It only extracts the user's intent. All hardware decisions are made by a rule-based backend configuration engine.
---

## Demo Video

▶ Watch the demo: https://www.youtube.com/watch?v=nRa5SJxBWAM

## Design Concept

<table>
<tr>
<td><img src="demo1.png" width="420"></td>
<td><img src="demo2.PNG" width="420"></td>
</tr>
<tr>
<td><img src="demo3.PNG" width="420"></td>
<td><img src="demo4.PNG" width="420"></td>
</tr>
</table>

## System Workflow
<p align="center">
<img src="system-flow.png" width="850">
</p>

---

### What Problem It Solves

Many beginners want a PC but are afraid of:
- incompatible parts
- wasting money on unbalanced builds
- not understanding technical specifications

RedCore aims to act like a knowledgeable friend who plans a balanced build automatically.

---

## Modes

### Beginner Mode (main)
The user types what they want in one text box and the system generates a full compatible build automatically.

### Experienced Mode (power user)
Users can choose key components (for example CPU or GPU) and the system completes the rest of the build with compatible parts.

---

## Build Result Output (Export)
After generation, the final build is **exported and shown on a results page** as a structured list/cards, for example:
- CPU
- GPU
- Motherboard
- RAM
- Storage
- PSU

Plus short explanations about why each part was chosen and any compromises.

---

### Output

After generation, the system returns a structured build:

- CPU
- GPU
- Motherboard
- RAM
- Storage
- PSU

Each component includes a short explanation of why it was selected and any compromises made.

---

## Architecture

Frontend: Framer (UI + pages)  
Backend: Cloudflare Worker (API / rule engine)  
AI: HuggingFace (Qwen2.5) intent extraction only
Database: Local JSON hardware database (exported from Airtable)

Flow:
User → Framer → Worker API → AI extraction → Rule Engine → Hardware Database → Final Build → Results Page

---

## Current Progress
✅ Framer UI is ~50% designed  
✅ Worker API running  
✅ AI extraction working (budget/purpose/tier)  
✅ JSON database migration completed (Airtable → JSON)  
✅ GPU selection engine implemented with downgrade safety  
✅ CPU selection based on GPU requirements and budget

---

## Next Steps
- Add RAM selection rules (capacity + DDR type)
- Motherboard selection (socket + RAM type match)
- PSU selection (wattage + connectors)
- Storage selection
- Improved results page explanations
- Later: interactive 3D PC preview

---

## Goal
Reduce the fear beginners have when choosing PC parts and simulate how a real technician plans a build.

Work in progress - feedback is welcome.
