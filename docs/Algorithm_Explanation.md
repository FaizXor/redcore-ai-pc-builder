# Purpose of the Algorithm

The purpose of the RedCore algorithm is to automatically generate a compatible desktop PC build based on a user's request. Many beginners struggle with selecting PC parts because hardware compatibility, performance balance, and budget allocation require technical knowledge.

The algorithm solves this problem by converting a natural-language request into a structured system decision process. The system analyzes the user's requirements, including budget, intended use, and performance tier, and then applies rule-based logic to select hardware components that satisfy compatibility constraints and budget limitations.

Instead of allowing the AI to directly choose parts, the AI is only used to extract structured data from the user's request. The actual hardware decisions are performed by the rule engine using predefined compatibility rules and hardware databases.

This design ensures that the final build is consistent, realistic, and technically valid while still allowing the user to interact with the system using simple natural-language input.

## Algorithm Explanation

The user types what they want in the Framer frontend. The request is then sent to a webhook hosted on Cloudflare Workers. When the Cloudflare Worker receives the request, it forwards the user's text input to the AI model Qwen 2.5 hosted on HuggingFace.

The AI receives a special prompt designed to extract only three structured values from the user's request: the budget, the purpose of the build, and the performance tier (Entry, Mid, High). The AI does not select hardware parts. Its only task is to convert the natural-language request into structured data.

The extracted data is returned as JSON. Example format:

>{
"budget_usd": "",
"purpose": "",
"performance_tier": ""
}

**Below is the prompt used for the extraction process:**

```
Extract only these three values from the user input.

Rules:
* budget_usd: number only (USD). If missing, estimate reasonably.
* purpose: must be exactly one of these values:
  Gaming
  Competitive Gaming
  Content Creation
  Streaming
  Office/School
* performance_tier: one of (Entry, Mid, High).

Mapping guidance:

* esports, fps, competitive, valorant, cs2 → Competitive Gaming
* gaming → Gaming
* video editing, rendering, blender, premiere, design → Content Creation
* streaming, twitch, broadcasting → Streaming
* homework, school, office, browsing, microsoft office → Office/School

If the user's request matches multiple purposes, choose the dominant one.

Return ONLY valid JSON in this format:
{
"budget_usd": "",
"purpose": "",
"performance_tier": ""
}
```
Before the selection process begins, the system defines internal variables for performance tiers:

**Entry = 1
Mid = 2
High = 3**

These numeric values allow the system to perform calculations and tier adjustments.

After the AI returns the extracted JSON, the purpose value is compared with entries inside the Purpose Database. The system retrieves configuration data associated with that purpose. This database contains rules such as tier adjustments and component budget percentages.

For example, a purpose like Gaming may increase GPU priority, while Office/School may reduce GPU tier expectations. These adjustments prevent unrealistic builds, such as selecting extremely high-end GPUs for simple office tasks.

The system then calculates the final GPU tier by combining the extracted tier and the purpose adjustment. Once the final GPU tier is determined, the system begins searching the GPU database.

The GPU is treated as the primary component because it strongly affects the selection of other components in the system.

When searching the GPU database, the system checks if a suitable GPU exists within the allocated GPU budget. If a GPU is found, the algorithm continues to the CPU selection stage.

If no GPU is found, the system downgrades the GPU tier by one level and retries the search. A downgrade limit is implemented to prevent infinite loops. The system allows a maximum of two downgrades because there are only three possible tiers (High, Mid, Entry). Mathematical checks ensure that the tier never goes below Entry.

The system also calculates component budgets. The GPU budget is calculated using:

>*Budget × Purpose Percentage × Tier Adjustment*

Other components use:

>*Budget × Purpose Percentage*

These percentages are defined in the purpose configuration table.

After a GPU is selected, the system proceeds to CPU selection. The GPU contains a parameter called CPU_req, which represents the minimum CPU performance requirement. This parameter is used to determine the CPU tier required for proper system balance.

The system searches the CPU database using the calculated CPU budget and the required CPU level. If a compatible CPU is found, the process continues to PSU selection. If no suitable CPU is found, the system performs a downgrade similar to the GPU selection logic.

For Power Supply Unit (PSU) selection, the algorithm extracts the minimum wattage requirement stored in the GPU data. This value is used to calculate the minimum PSU wattage required for the system.

Unlike GPU or CPU selection, the PSU stage does not allow downgrading because power requirements must be satisfied to ensure system stability. If a suitable PSU is not found within the budget and wattage requirement, the algorithm stops and returns an error.

During motherboard selection, the system extracts the CPU socket and preferred chipset information from the selected CPU. It also determines the supported DDR memory type. Chipsets are internally represented as numeric values to simplify comparison.

The system searches the motherboard database using the calculated motherboard budget, socket compatibility, chipset preference, and memory type.

If no motherboard is found with the preferred chipset, the algorithm removes the chipset restriction and limits the search to compatible DDR types (for example DDR4). If a suitable motherboard is still not found, the system stops and returns an error.

For RAM selection, the system uses preferred RAM capacity values defined in the purpose configuration table. Because RAM prices fluctuate frequently, the system includes a fallback mechanism. If an optimal configuration cannot be found, the system defaults to 16 GB of RAM.

Finally, storage selection is performed based on performance tier and remaining budget. The system determines a target storage size and searches the storage database. If a suitable drive is not found, the algorithm reduces the storage size and retries the search.

If no compatible storage device can be found after the fallback attempts, the system stops and returns an error.

## Algorithm Workflow Diagrams

The following diagrams illustrate the complete rule engine workflow and component selection logic used by the RedCore system.

### Full Algorithm Flow

![Full Algorithm Diagram](../Design/Workflow_Diagram_Full.png)

### Early Algorithm Design

![Early Workflow Design](../Design/Workflow_early_design.jpg)
Once all components are successfully selected, the algorithm exports the complete build configuration including component names, specifications, and descriptions. The result is sent back to the webhook, which forwards the response to the Framer frontend where the final build is displayed to the user.

