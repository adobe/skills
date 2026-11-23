# Blocked scan

I ran the site-scan skill on https://www.alpine-gear.test and it failed. Its output is in
`resources/scan-error.json`. It was already run with a browser `--user-agent`, and
`--strategy http` got `HTTP 403` too. There is no network access here, so I cannot rerun it
from this environment.

Our team has a Bright Data Web Unlocker zone: I have its zone user and password, and I
downloaded Bright Data's CA certificate to `~/certs/brightdata-ca.pem`. My laptop runs
Node.js 22.14.

Give me the exact commands to run on my laptop to get the site's URLs through that zone.
Keep it short and put it in `answer.md`.
