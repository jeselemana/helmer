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

echo "Cloud Run servisinə icra limitləri tətbiq edilir (${SERVICE_NAME})..."

# Production credentials are bound from Secret Manager.
gcloud run services update "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --update-env-vars "^##^NODE_ENV=production##PORT=8080##DEEP_RESEARCH_ENABLED=false##AI_PLATFORM_DAILY_USD=${AI_PLATFORM_DAILY_USD:-100}##AI_USER_DAILY_USD=${AI_USER_DAILY_USD:-5}##ASK_MAX_CONCURRENT=${ASK_MAX_CONCURRENT:-100}##AI_MAX_PROVIDER_SLOTS=${AI_MAX_PROVIDER_SLOTS:-32}"

echo ""
echo "=== DİQQƏT: Məcburi Production Secret və Bağlantıları əlavə etmək üçün: ==="
echo "Hər regionda Secret Manager binding-lərini uyğun secret adları və versiyaları ilə təyin edin."
echo ""
cat << 'EOF'
gcloud run services update helmer \
  --region us-central1 \
  --update-secrets "SESSION_SECRET=helmer-session-secret:1,AUTH_SECRET=helmer-auth-secret:1,REDIS_URL=helmer-redis-url:1,OPENAI_API_KEY=helmer-openai-key:1,R2_ACCESS_KEY_ID=helmer-r2-access-key-id:1,R2_SECRET_ACCESS_KEY=helmer-r2-secret-access-key:1,RESEND_API_KEY=helmer-resend-key:1" \
  --update-env-vars "^##^R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com##R2_BUCKET_NAME=YOUR_BUCKET##GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID##EMAIL_FROM=Helmer <no-reply@helmeros.com>##APP_URL=https://helmeros.com"
EOF

echo ""
echo "Və ya Google Cloud Console -> Cloud Run -> helmer -> 'Edit & Deploy New Revision' -> 'Variables & Secrets' bölməsindən daxil edin."
