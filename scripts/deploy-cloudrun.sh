#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Helmer - Google Cloud Run Clean Build & Deploy Script
# ==============================================================================
# Bu skript layihəni heç bir gizli fayl (.env, data/*.json) daxil olmadan
# Google Cloud Build vasitəsilə buludda təhlükəsiz build edib Cloud Run-a yerləşdirir.
# ==============================================================================

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
BUILD_REGION="${GOOGLE_CLOUD_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-marketify-ai}"
AR_REPO="${AR_REPOSITORY:-cloud-run-source-deploy}"
COMMIT_TAG="$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')-$(date +%s)"
IMAGE_NAME="${BUILD_REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:${COMMIT_TAG}"

echo "=== 1. Təhlükəsizlik yoxlanışı ==="
if [ ! -f ".dockerignore" ] || ! grep -q "\.env\*" .dockerignore; then
  echo "❌ Xəta: .dockerignore faylında .env* qeydi tapılmadı!"
  exit 1
fi

if [ ! -f ".gcloudignore" ] || ! grep -q "\.env\*" .gcloudignore; then
  echo "❌ Xəta: .gcloudignore faylında .env* qeydi tapılmadı!"
  exit 1
fi
echo "✅ .dockerignore və .gcloudignore təhlükəsizliyi təsdiqləndi (.env* kənarlaşdırılıb)."

if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]]; then
  echo "❌ Xəta: GCP Project ID təyin edilməyib. Əvvəlcə 'gcloud config set project <PROJECT_ID>' icra edin."
  exit 1
fi

# Attached service account uses ADC; no downloaded service-account keys.
SERVICE_ACCOUNT="${CLOUD_RUN_SERVICE_ACCOUNT:-helmer-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
if [[ ! "$SERVICE_ACCOUNT" =~ ^[a-zA-Z0-9._-]+@${PROJECT_ID}\.iam\.gserviceaccount\.com$ ]]; then
  echo "Invalid Cloud Run service account."
  exit 1
fi
gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project "$PROJECT_ID" >/dev/null

echo "Layihə: ${PROJECT_ID}"
echo "Servis: ${SERVICE_NAME}"
echo "İmage:  ${IMAGE_NAME}"

echo "=== 2. Təmiz Docker Image Build (Google Cloud Build vasitəsilə) ==="
# Lokal Docker tələb olunmur, birbaşa GCP Cloud Build üzərində təmiz build olunur
gcloud builds submit --tag "${IMAGE_NAME}" .

# Regions to deploy
TARGET_REGIONS=("us-central1" "europe-west3")
for REGION in "${TARGET_REGIONS[@]}"; do
  LOCATION="us"
  if [[ "$REGION" =~ ^europe- ]]; then
    LOCATION="eu"
  fi
  echo "=== 3. Cloud Run Deploy: ${REGION} (location: ${LOCATION}) ==="
  gcloud run deploy "${SERVICE_NAME}" \
    --image "${IMAGE_NAME}" \
    --platform managed \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --service-account "${SERVICE_ACCOUNT}" \
    --allow-unauthenticated \
    --port 8080 \
    --timeout 3600 \
    --memory 1Gi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --update-env-vars "^##^NODE_ENV=production##GEMINI_USE_VERTEX=true##GOOGLE_CLOUD_PROJECT=${PROJECT_ID}##GOOGLE_CLOUD_LOCATION=${LOCATION}##GOOGLE_CLOUD_REGION=${REGION}"
  echo "✅ ${REGION} deploy uğurla tamamlandı!"
done

echo "🎉 Bütün serverlərdə (us-central1 və europe-west3) deploy uğurla başa çatdı!"
