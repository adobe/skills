# Fixtures — hand-written items for the supervisor batteries

Recorded runs rarely contain the failure a supervisor exists to catch (an agent writing "gated by
eye" into a ledger is exactly what the ledger guard now prevents), so the negative class is
written by hand in the corpus's own style, generic, with no site named. Each line is one replay
item: `{ battery, ref, state, expected }`. The positive class (evidenced claims, complete briefs,
batched decisions) comes from the recorded runs through `harvest.mjs`; these files add the other
side. Treat agreement on these as a separation test, not a field accuracy.
