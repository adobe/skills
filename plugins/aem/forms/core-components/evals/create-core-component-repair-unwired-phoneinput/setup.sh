#!/usr/bin/env bash
# Builds the broken state: a phoneinput copied from telephoneinput, left out of pom.xml and runtime-all.
set -euo pipefail
B=ui.af.apps/src/main/content/jcr_root/apps/core/fd/components/form
cp -R "$B/telephoneinput" "$B/phoneinput"
mv "$B/phoneinput/v1/telephoneinput" "$B/phoneinput/v1/phoneinput"
find "$B/phoneinput" -depth -name '*telephoneinput*' | while read -r f; do mv "$f" "$(dirname "$f")/$(basename "$f" | sed 's/telephoneinput/phoneinput/g')"; done
grep -rl 'telephoneinput' "$B/phoneinput" | xargs sed -i.bak 's/telephoneinput/phoneinput/g; s/telephoneInput/phoneInput/g'
find "$B/phoneinput" -name '*.bak' -delete
# own clientlib category, mixed case like datePicker, so the runtime-all embed can't be guessed
sed -i.bak 's/core\.forms\.components\.textinput\.v1\.runtime/core.forms.components.phoneInput.v1.runtime/' "$B/phoneinput/v1/phoneinput/clientlibs/site/.content.xml"
rm -f "$B/phoneinput/v1/phoneinput/clientlibs/site/.content.xml.bak"
