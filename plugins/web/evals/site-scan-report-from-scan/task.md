# Site inventory for a migration

We are planning the migration of https://www.northwind-outdoor.com and I need the
page inventory. There is no network access in this environment, so I ran the
site-scan skill's `web site scan` on my laptop and saved its JSON output in
`resources/scan-output.json`.

Using the site-scan skill's reading of that output, give me: how many pages the
site has per language, which of them I should leave out of a migration scope
(I do not want the archive), and whether I can trust that this is the whole site.
Keep the filtered URL list in the working directory as `urls.txt` (one URL per
line) and write your findings to `answer.md`.
