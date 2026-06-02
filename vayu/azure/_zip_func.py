"""Zip a folder with FORWARD-SLASH entry names (Linux-correct) for Azure Functions zip-deploy.
PowerShell Compress-Archive writes backslash entries that the Linux Functions host mishandles.
Usage: python _zip_func.py <src_dir> <out.zip>
"""
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, src).replace(os.sep, "/")
            z.write(full, arc)
print("zip:", round(os.path.getsize(out) / 1024 / 1024, 2), "MB")
