# breeva-cctv (task N-33): Lambda container image for AWS Jakarta. Built by infra/cctv/deploy.sh from a context folder
# holding the three modules and model/yolox_s.onnx (YOLOX release 0.1.1rc0, Apache-2.0).
FROM public.ecr.aws/lambda/python:3.12
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt && pip freeze
COPY cctv_count.py hitung.py app.py ${LAMBDA_TASK_ROOT}/
COPY model/yolox_s.onnx ${LAMBDA_TASK_ROOT}/model/
CMD ["app.handler"]
