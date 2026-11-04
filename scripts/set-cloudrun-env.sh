#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Helmer - Google Cloud Run Environment Variables Setup
# ==============================================================================
# Bu skript lazımi mühit dəyişənlərini birbaşa Cloud Run servisinə tətbiq edir.
# Qiymətləri .env faylınızdan və ya aşağıdakı parametrlərdən götürə bilərsiniz.
# ==============================================================================

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GOOGLE_CLOUD_REGION:-us-central1}"
LOCATION="${GOOGLE_CLOUD_LOCATION:-us}"
SERVICE_NAME="${SERVICE_NAME:-marketify-ai}"

if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]]; then
  echo "❌ GCP Project ID tapılmadı. 'gcloud config set project <PROJECT_ID>' icra edin."
  exit 1
fi

# Attached service account uses ADC; no downloaded service-account keys.
SERVICE_ACCOUNT="${CLOUD_RUN_SERVICE_ACCOUNT:-helmer-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
if [[ ! "$SERVICE_ACCOUNT" =~ ^[a-zA-Z0-9._-]+@${PROJECT_ID}\.iam\.gserviceaccount\.com$ ]]; then
  echo "Invalid Cloud Run service account."
  exit 1
fi
gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project "$PROJECT_ID" >/dev/null

echo "Cloud Run servisinə Vertex AI və əməliyyat limitləri tətbiq edilir (${SERVICE_NAME})..."

# Build always uses ADC; Vertex Express/API key authentication is prohibited for Build.
gcloud run services update "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --update-env-vars "^##^NODE_ENV=production##PORT=8080##GEMINI_USE_VERTEX=true##GOOGLE_CLOUD_LOCATION=${LOCATION}##GOOGLE_CLOUD_REGION=${REGION}##GOOGLE_CLOUD_PROJECT=${PROJECT_ID}##AI_PLATFORM_DAILY_USD=${AI_PLATFORM_DAILY_USD:-100}##AI_USER_DAILY_USD=${AI_USER_DAILY_USD:-5}##AI_MAX_GLOBAL_CONCURRENCY=${AI_MAX_GLOBAL_CONCURRENCY:-32}"

echo ""
echo "=== DİQQƏT: Məcburi Production Secret və Bağlantıları əlavə etmək üçün: ==="
echo "Aşağıdakı əmri öz açarlarınızla icra edin (Vertex AI istifadə edərkən GEMINI_API_KEY təyin etməyin):"
echo ""
cat << 'EOF'
gcloud run services update helmer \
  --region us-central1 \
  --update-env-vars "^##^SESSION_SECRET=YOUR_SESSION_SECRET##AUTH_SECRET=YOUR_AUTH_SECRET##REDIS_URL=YOUR_REDIS_URL##OPENAI_API_KEY=YOUR_OPENAI_KEY##GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID##R2_ENDPOINT=YOUR_R2_ENDPOINT##R2_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY##R2_SECRET_ACCESS_KEY=YOUR_R2_SECRET_KEY##R2_BUCKET_NAME=innovagrp##RESEND_API_KEY=YOUR_RESEND_KEY##EMAIL_FROM=Helmer <no-reply@helmeros.com>##APP_URL=https://helmeros.com"
EOF

echo ""
echo "Və ya Google Cloud Console -> Cloud Run -> helmer -> 'Edit & Deploy New Revision' -> 'Variables & Secrets' bölməsindən daxil edin."
