# Evaluating a spec (optional)

When a migration of the same site exists, score the spec against what it built: per page, the set of block
families the spec predicts vs the families of the blocks the migration authored (precision, recall, pages whose
sets match), redirects predicted vs the migration's redirect sheet, and the late issues of the migration's journal
that the spec shows up front. Report it internally only.

Run the judgement twice: once by the scoping context, once by a fresh context with no access to the migration
(read bans on its repository, notes and the first mapping), each tagging blocks with the neutral families. Report
both scores and their agreement. In the one measured case: 92.5% / 94.9% (informed) vs 90.6% / 95.3% (blind),
identical family sets on 75% of pages; the misses common to both were naming conventions (headings authored as
blocks, nested blocks carried as fragments) — the case for one block-naming contract between spec and migration.
