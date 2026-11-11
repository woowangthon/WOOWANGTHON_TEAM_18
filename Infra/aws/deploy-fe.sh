#!/usr/bin/env bash
# Build FE/ and publish it to the S3 bucket behind CloudFront (https://app.stairnoworks.com, docs/design/platform-hosting.md).
# Run from the operator's machine with AWS credentials that can write the bucket and invalidate the distribution:
#   FE_BUCKET=... CF_DISTRIBUTION_ID=... VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... \
#   VITE_API_BASE_URL=https://api.stairnoworks.com bash Infra/aws/deploy-fe.sh
# The VITE_* values are baked into the public bundle, so only public values go here (never a secret key).
set -euo pipefail
: "${FE_BUCKET:?}" "${CF_DISTRIBUTION_ID:?}" "${VITE_SUPABASE_URL:?}" "${VITE_SUPABASE_PUBLISHABLE_KEY:?}" "${VITE_API_BASE_URL:?}"
cd "$(dirname "$0")/../../FE"

pnpm install --frozen-lockfile
pnpm build

# Hashed assets first and never deleted, so a browser still holding the previous index.html can load its files.
# --size-only: a hashed name already fixes the content, so unchanged files are not uploaded again.
aws s3 sync dist/assets "s3://$FE_BUCKET/assets" --size-only --cache-control 'public,max-age=31536000,immutable'
aws s3 sync dist "s3://$FE_BUCKET" --delete --exclude 'assets/*' --cache-control 'no-cache'
aws cloudfront create-invalidation --distribution-id "$CF_DISTRIBUTION_ID" --paths '/index.html' '/' --query 'Invalidation.Id' --output text
