#!/usr/bin/env bash
# breeva-cctv (task N-33) in AWS Jakarta: base stack (bucket + repository), container image, counting stack with the
# 20-minute schedule ending 6 Dec 2026 00.00 WIB. Run from the repository root:
#   bash infra/cctv/deploy.sh [camera-list.json]
# MODEL_ONNX points at yolox_s.onnx (YOLOX release 0.1.1rc0); the optional camera list (private: id, kota, url, lat, lon)
# is uploaded as kamera.json to the private bucket.
set -euo pipefail
REGION=ap-southeast-3
MODEL_ONNX="${MODEL_ONNX:-D:/breeva-ml-data/models/yolox/yolox_s.onnx}"
ACCT=$(aws sts get-caller-identity --query Account --output text)
REG="$ACCT.dkr.ecr.$REGION.amazonaws.com"
TAG=$(git rev-parse --short HEAD)

aws cloudformation deploy --region "$REGION" --stack-name breeva-cctv-dasar \
  --template-file infra/aws/breeva-cctv-dasar.yaml --tags project=breeva --no-fail-on-empty-changeset

CTX=$(mktemp -d)
trap 'rm -rf "$CTX"' EXIT
cp vayu/field/cctv_count.py infra/cctv/hitung.py infra/cctv/app.py infra/cctv/requirements.txt infra/cctv/Dockerfile "$CTX/"
mkdir -p "$CTX/model" && cp "$MODEL_ONNX" "$CTX/model/yolox_s.onnx"
docker build --platform linux/amd64 --provenance=false -t "$REG/breeva-cctv:$TAG" "$CTX"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REG" >/dev/null
docker push "$REG/breeva-cctv:$TAG" >/dev/null
DIGEST=$(aws ecr describe-images --region "$REGION" --repository-name breeva-cctv --image-ids imageTag="$TAG" \
  --query 'imageDetails[0].imageDigest' --output text)

if [ "${1:-}" != "" ]; then
  aws s3api put-object --region "$REGION" --bucket "breeva-cctv-$ACCT" --key kamera.json --body "$1" \
    --content-type application/json >/dev/null
fi
aws cloudformation deploy --region "$REGION" --stack-name breeva-cctv --template-file infra/aws/breeva-cctv.yaml \
  --capabilities CAPABILITY_NAMED_IAM --tags project=breeva --no-fail-on-empty-changeset \
  --parameter-overrides "ImageUri=$REG/breeva-cctv@$DIGEST"
echo "breeva-cctv: image $TAG ($DIGEST)"
