#!/usr/bin/env bash
# breeva-cctv (task N-33) in AWS Jakarta: base stack (bucket, repository, CodeBuild), the image built INSIDE AWS by
# CodeBuild (only the small source zip leaves this PC; the model is fetched from the YOLOX release and checked by
# sha256), then the counting stack with the 20-minute schedule ending 6 Dec 2026 00.00 WIB. From the repository root:
#   bash infra/cctv/deploy.sh [camera-list.json]
# The optional camera list (private: id, kota, nama, url, lat, lon) is uploaded as kamera.json to the private bucket.
set -euo pipefail
REGION=ap-southeast-3
ACCT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="breeva-cctv-$ACCT"
TAG=$(git rev-parse --short HEAD)

aws cloudformation deploy --region "$REGION" --stack-name breeva-cctv-dasar \
  --template-file infra/aws/breeva-cctv-dasar.yaml --capabilities CAPABILITY_NAMED_IAM --tags project=breeva \
  --no-fail-on-empty-changeset

ZIP=$(mktemp -d)/source.zip
python -I - "$ZIP" <<'PY'
import sys, zipfile
src = {"cctv_count.py": "vayu/field/cctv_count.py", "hitung.py": "infra/cctv/hitung.py", "app.py": "infra/cctv/app.py",
       "requirements.txt": "infra/cctv/requirements.txt", "Dockerfile": "infra/cctv/Dockerfile", "buildspec.yml": "infra/cctv/buildspec.yml"}
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for name, path in src.items():
        z.write(path, name)
PY
aws s3api put-object --region "$REGION" --bucket "$BUCKET" --key build/source.zip --body "$ZIP" >/dev/null
BUILD=$(aws codebuild start-build --region "$REGION" --project-name breeva-cctv-build \
  --environment-variables-override "name=IMAGE_TAG,value=$TAG,type=PLAINTEXT" --query build.id --output text)
echo "build $BUILD"
while :; do
  ST=$(aws codebuild batch-get-builds --region "$REGION" --ids "$BUILD" --query 'builds[0].buildStatus' --output text)
  [ "$ST" = IN_PROGRESS ] || break
  sleep 15
done
echo "build status $ST"
[ "$ST" = SUCCEEDED ] || exit 1
DIGEST=$(aws ecr describe-images --region "$REGION" --repository-name breeva-cctv --image-ids imageTag="$TAG" \
  --query 'imageDetails[0].imageDigest' --output text)

if [ "${1:-}" != "" ]; then
  aws s3api put-object --region "$REGION" --bucket "$BUCKET" --key kamera.json --body "$1" --content-type application/json >/dev/null
fi
aws cloudformation deploy --region "$REGION" --stack-name breeva-cctv --template-file infra/aws/breeva-cctv.yaml \
  --capabilities CAPABILITY_NAMED_IAM --tags project=breeva --no-fail-on-empty-changeset \
  --parameter-overrides "ImageUri=$ACCT.dkr.ecr.$REGION.amazonaws.com/breeva-cctv@$DIGEST"
echo "breeva-cctv: image $TAG ($DIGEST)"
