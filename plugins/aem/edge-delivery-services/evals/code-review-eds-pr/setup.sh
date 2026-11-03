#!/usr/bin/env bash
set -euo pipefail
change=$(mktemp -d)
cp -R .summer-promo/. "$change"/
rm -rf .summer-promo
tmp=$(mktemp -d)
git clone --quiet https://github.com/adobe/aem-boilerplate.git "$tmp"
git -C "$tmp" checkout --quiet 5cea543707db900c92014b0bba93564fe325b9e4
rm -rf "$tmp/.git"
cp -R "$tmp"/. .
rm -rf "$tmp"

git init --quiet -b main
git add -A
git -c user.name=dev -c user.email=dev@example.com commit --quiet -m "chore: aem-boilerplate 5cea543"
git checkout --quiet -b summer-promo

cp -R "$change"/. .
rm -rf "$change"
cat >> scripts/aem.js <<'EOF'

export function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
EOF
cat >> head.html <<'EOF'
<script async src="https://www.googletagmanager.com/gtag/js?id=G-SUMMER2026"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-SUMMER2026');
</script>
EOF
npm pkg set dependencies.dayjs=1.11.13
mkdir -p images
head -c 65536 /dev/urandom > images/summer-hero.jpg

git add -A
git -c user.name=dev -c user.email=dev@example.com commit --quiet -m "feat: summer promo banner, cards CTA, GA4 tracking"
