"""
VAYU Engine — Copernicus CDSE NDVI Integration (Stage 11.3)
=============================================================
Fetches Normalized Difference Vegetation Index (NDVI) from Copernicus
Data Space Ecosystem (CDSE) to replace OSM landuse proxy with actual
satellite-derived vegetation density.

Higher NDVI = more vegetation = better air quality (pollution absorption).
NDVI range: -1.0 to 1.0 (>0.3 = moderate vegetation, >0.6 = dense forest)

Uses Sentinel-2 L2A data via CDSE OGC API.
"""

from __future__ import annotations

import logging
import math
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

log = logging.getLogger("vayu.calibration.ndvi")

# Copernicus CDSE Catalogue API
CDSE_CATALOGUE_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1"
CDSE_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"
REQUEST_TIMEOUT = 30.0


@dataclass
class NDVIResult:
    lat: float
    lon: float
    ndvi_mean: float       # -1 to 1
    ndvi_max: float
    vegetation_class: str  # 'bare', 'sparse', 'moderate', 'dense', 'forest'
    air_quality_factor: float  # Multiplier: lower = cleaner air from vegetation
    acquisition_date: str
    cloud_cover: float


def classify_vegetation(ndvi: float) -> tuple[str, float]:
    """
    Classify NDVI into vegetation class and derive AQ factor.

    Returns: (class_name, aq_factor)
    aq_factor < 1.0 means vegetation improves air quality.
    """
    if ndvi < 0.1:
        return ("bare", 1.10)       # No vegetation, urban heat island
    elif ndvi < 0.2:
        return ("sparse", 1.00)     # Minimal vegetation
    elif ndvi < 0.4:
        return ("moderate", 0.85)   # Parks, gardens
    elif ndvi < 0.6:
        return ("dense", 0.75)      # Dense trees, forest edges
    else:
        return ("forest", 0.65)     # Full canopy forest


def fetch_ndvi_openmeteo(lat: float, lon: float) -> NDVIResult | None:
    """
    Fallback: estimate vegetation from Open-Meteo land cover data.
    Open-Meteo doesn't provide NDVI directly, but we can approximate
    from elevation and known landuse patterns.
    """
    # This is a simplified proxy — proper CDSE integration below
    try:
        resp = httpx.get(
            "https://api.open-meteo.com/v1/elevation",
            params={"latitude": lat, "longitude": lon},
            timeout=10.0,
        )
        resp.raise_for_status()
        elevation = resp.json().get("elevation", [100])[0]

        # Indonesian heuristic: lowland urban < 100m = less vegetation
        # Highland > 500m = more forest
        if elevation < 50:
            ndvi_est = 0.15  # Coastal/urban
        elif elevation < 200:
            ndvi_est = 0.25  # Lowland mixed
        elif elevation < 500:
            ndvi_est = 0.40  # Hill area
        else:
            ndvi_est = 0.55  # Highland forest

        veg_class, aq_factor = classify_vegetation(ndvi_est)

        return NDVIResult(
            lat=lat, lon=lon,
            ndvi_mean=round(ndvi_est, 3),
            ndvi_max=round(ndvi_est + 0.1, 3),
            vegetation_class=veg_class,
            air_quality_factor=aq_factor,
            acquisition_date="estimated",
            cloud_cover=0.0,
        )
    except Exception as exc:
        log.warning("NDVI estimation failed: %s", exc)
        return None


def fetch_ndvi_cdse(
    lat: float, lon: float,
    bbox_size_deg: float = 0.005,  # ~500m box
) -> NDVIResult | None:
    """
    Fetch NDVI from Copernicus CDSE using Sentinel Hub Process API.
    Requires CDSE_CLIENT_ID and CDSE_CLIENT_SECRET env vars.

    Falls back to Open-Meteo estimation if CDSE credentials unavailable.
    """
    client_id = os.environ.get("CDSE_CLIENT_ID", "")
    client_secret = os.environ.get("CDSE_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        log.info("CDSE credentials not set — using Open-Meteo fallback")
        return fetch_ndvi_openmeteo(lat, lon)

    # Get access token
    token = _get_cdse_token(client_id, client_secret)
    if not token:
        return fetch_ndvi_openmeteo(lat, lon)

    # Define bounding box
    west = lon - bbox_size_deg
    east = lon + bbox_size_deg
    south = lat - bbox_size_deg
    north = lat + bbox_size_deg

    # Time range: last 30 days (to find cloud-free image)
    now = datetime.now(timezone.utc)
    date_from = (now - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
    date_to = now.strftime("%Y-%m-%dT23:59:59Z")

    # Sentinel Hub Process API request for NDVI
    evalscript = """
    //VERSION=3
    function setup() {
        return {
            input: [{bands: ["B04", "B08", "SCL"]}],
            output: {bands: 1, sampleType: "FLOAT32"}
        };
    }
    function evaluatePixel(sample) {
        // Skip clouds (SCL: 8=cloud medium, 9=cloud high, 10=cirrus)
        if (sample.SCL >= 8) return [-2];
        let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
        return [ndvi];
    }
    """

    payload = {
        "input": {
            "bounds": {
                "bbox": [west, south, east, north],
                "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {"from": date_from, "to": date_to},
                    "maxCloudCoverage": 30,
                    "mosaickingOrder": "leastCC",
                },
            }],
        },
        "output": {
            "width": 10,
            "height": 10,
            "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}],
        },
        "evalscript": evalscript,
    }

    try:
        resp = httpx.post(
            CDSE_PROCESS_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()

        # Parse GeoTIFF response — extract NDVI values
        # For simplicity, we compute statistics from raw bytes
        # In production, use rasterio for proper GeoTIFF parsing
        raw = np.frombuffer(resp.content[-400:], dtype=np.float32)
        valid = raw[(raw > -1.5) & (raw < 1.0)]

        if len(valid) == 0:
            log.info("No valid NDVI pixels for (%.4f, %.4f) — cloudy?", lat, lon)
            return fetch_ndvi_openmeteo(lat, lon)

        ndvi_mean = float(np.mean(valid))
        ndvi_max = float(np.max(valid))
        veg_class, aq_factor = classify_vegetation(ndvi_mean)

        return NDVIResult(
            lat=lat, lon=lon,
            ndvi_mean=round(ndvi_mean, 3),
            ndvi_max=round(ndvi_max, 3),
            vegetation_class=veg_class,
            air_quality_factor=aq_factor,
            acquisition_date=date_to[:10],
            cloud_cover=0.0,
        )
    except Exception as exc:
        log.warning("CDSE NDVI fetch failed: %s — using fallback", exc)
        return fetch_ndvi_openmeteo(lat, lon)


def _get_cdse_token(client_id: str, client_secret: str) -> str | None:
    """Obtain OAuth2 access token from CDSE."""
    try:
        resp = httpx.post(
            "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json().get("access_token")
    except Exception as exc:
        log.warning("CDSE token fetch failed: %s", exc)
        return None


def batch_ndvi(
    points: list[tuple[float, float]],
    use_cdse: bool = True,
) -> list[NDVIResult | None]:
    """Fetch NDVI for multiple points."""
    results = []
    for lat, lon in points:
        if use_cdse:
            result = fetch_ndvi_cdse(lat, lon)
        else:
            result = fetch_ndvi_openmeteo(lat, lon)
        results.append(result)
    return results
