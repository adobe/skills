# No Hallucination Rules

**STRICT REQUIREMENT**: When user provides dialog specification, follow these rules exactly.

---

## Core Rules

1. **Create ONLY the fields explicitly specified** - No additional fields
2. **Use EXACT field names provided** - Do not rename or "improve" names
3. **Use EXACT field types provided** - Do not substitute "better" alternatives
4. **Preserve EXACT field order** - Match the order in the specification
5. **Do NOT add fields you think are "missing"** - Even if they seem useful
6. **ASK if unclear** - If specification is ambiguous, ask before creating

---

## Verification Checklist

Before creating dialog:
- [ ] Field count matches specification exactly
- [ ] Field names match specification exactly (case-sensitive)
- [ ] Field types match specification exactly
- [ ] No additional fields added
- [ ] No fields removed or renamed

---

## NEVER Do This

- "I'll add a 'title' field since most components need one"
- "I'll add an 'id' field for accessibility"
- "I'll rename 'desc' to 'description' for clarity"
- "I'll add validation that wasn't specified"

---

## DO This Instead

- Create exactly what was specified
- After creation, ask: "Would you like me to add any additional fields?"
