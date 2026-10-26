---
name: search-adobe-developer-docs
description: Use when the user asks any question about Adobe developer products, APIs, SDKs, platform concepts, or best practices — phrases like "what is App Builder", "how do I set up webhooks", "what authentication options does Adobe X support", "how do I deploy a runtime action", "what is a product profile", "how do I create an OAuth credential", "explain Express Add-ons", "search Adobe docs", "look up Adobe documentation", "find me Adobe developer docs".
license: Apache-2.0
---

# Search Adobe Developer Docs

Retrieve grounded answers from official Adobe developer documentation. This skill is a **retriever** — passages are fetched and returned for you to synthesize into a final answer. Do not answer from training knowledge alone.

---

## When to invoke

- Any question about Adobe developer products, APIs, SDKs, or platform concepts
- Before starting a provisioning flow (credential creation, API subscription, I/O Events setup) — gather context first
- When the user explicitly asks to search Adobe documentation

---

## Flow

### Step 1 — Check if scoped to a specific product

Does the user mention a specific product (e.g. *"search only App Builder docs"*, *"look this up in Express Add-ons docs"*)?

- **Yes** → Call `list_doc_collections` to get available collection IDs. Match the user's product to a `collectionId`. Proceed to Step 2 with that `collectionId`.
- **No** → Proceed to Step 2 with no `collectionId` (searches all collections).

### Step 2 — Retrieve passages

Call `search_adobe_docs` with:
- `query`: the user's question or topic as-is
- `collectionId`: from Step 1 (omit to search all)
- `numberOfResults`: 5 (default) — increase to 10 if the question is broad

### Step 3 — Handle results

**Results found:**

Synthesize the answer from the returned passages. For each passage used, cite the source:

```
{Your synthesized answer}

Sources:
- {title} — {sourceUrl}
- {title} — {sourceUrl}
```

**Zero results:**

Tell the user no documentation was found and suggest:
```
No results found for "{query}". Try:
- Rephrasing with different keywords
- Using a broader search term
- Scoping to a specific collection (e.g. App Builder, Express Add-ons)
```

Then offer to retry with a rephrased query.

---

## Rules

- Never answer Adobe documentation questions from training knowledge alone — always call `search_adobe_docs` first
- Always cite source URLs from the returned passages
- Synthesis happens here in the LLM — the tool only retrieves; do not ask the tool to generate answers
- If the user asks about a product not covered by any collection, tell them the available collections (from `list_doc_collections`) and suggest the closest match
