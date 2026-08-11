#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?Thiếu SUPABASE_URL}"
: "${BOOTSTRAP_SECRET:?Thiếu BOOTSTRAP_SECRET}"
: "${ADMIN_EMPLOYEE_CODE:?Thiếu ADMIN_EMPLOYEE_CODE}"
: "${ADMIN_FULL_NAME:?Thiếu ADMIN_FULL_NAME}"
: "${ADMIN_PASSWORD:?Thiếu ADMIN_PASSWORD}"

payload=$(jq -n \
  --arg employee_code "$ADMIN_EMPLOYEE_CODE" \
  --arg full_name "$ADMIN_FULL_NAME" \
  --arg contractor "${ADMIN_CONTRACTOR:-}" \
  --arg password "$ADMIN_PASSWORD" \
  '{employee_code:$employee_code,full_name:$full_name,contractor:$contractor,password:$password}')

curl --fail-with-body --max-time 60 \
  -X POST "$SUPABASE_URL/functions/v1/api/bootstrap-admin" \
  -H 'content-type: application/json' \
  -H "x-bootstrap-secret: $BOOTSTRAP_SECRET" \
  -d "$payload"

printf '\nAdmin đầu tiên đã được tạo; endpoint bootstrap từ giờ tự khóa.\n'
