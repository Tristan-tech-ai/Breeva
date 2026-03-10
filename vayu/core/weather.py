"""
VAYU Engine — Weather Fetcher (Open-Meteo)
============================================
Async weather and air-quality baseline data from Open-Meteo APIs.
No API key required. ERD Section 5.1.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("vayu.weather")

OPEN_METEO_WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

REQUEST_TIMEOUT = 15.0  # seconds


@dataclass
class WeatherData:
    wind_speed: float       # m/s
    wind_direction: float   # degrees (meteorological)
    temperature: float      # °C
    humidity: float         # %
    cloud_cover: float      # fraction 0-1
    precipitation: float    # mm last 1h


@dataclass
class AirQualityBaseline:
    pm25: float   # μg/m³
    pm10: float
    no2: float    # μg/m³
    co: float     # μg/m³
    o3: float     # μg/m³


# Fallback values for Indonesia tropical conditions
DEFAULT_WEATHER = WeatherData(
    wind_speed=2.0, wind_direction=0, temperature=28,
    humidity=70, cloud_cover=0.5, precipitation=0.0,
)

DEFAULT_AQ = AirQualityBaseline(
    pm25=20.0, pm10=30.0, no2=15.0, co=300.0, o3=40.0,
)


async def fetch_weather(lat: float, lon: float) -> WeatherData:
    """Fetch current weather from Open-Meteo."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "wind_speed_10m,wind_direction_10m,temperature_2m,"
                   "relative_humidity_2m,cloud_cover,precipitation",
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(OPEN_METEO_WEATHER_URL, params=params)
            resp.raise_for_status()
            c = resp.json().get("current", {})
        return WeatherData(
            wind_speed=c.get("wind_speed_10m", 2.0),
            wind_direction=c.get("wind_direction_10m", 0),
            temperature=c.get("temperature_2m", 28),
            humidity=c.get("relative_humidity_2m", 70),
            cloud_cover=c.get("cloud_cover", 50) / 100.0,
            precipitation=c.get("precipitation", 0),
        )
    except Exception as exc:
        log.warning("Open-Meteo weather fetch failed: %s — using defaults", exc)
        return DEFAULT_WEATHER


async def fetch_air_quality(lat: float, lon: float) -> AirQualityBaseline:
    """Fetch baseline air quality from Open-Meteo Air Quality API."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone",
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(OPEN_METEO_AQ_URL, params=params)
            resp.raise_for_status()
            c = resp.json().get("current", {})
        return AirQualityBaseline(
            pm25=c.get("pm2_5", 20.0),
            pm10=c.get("pm10", 30.0),
            no2=c.get("nitrogen_dioxide", 15.0),
            co=c.get("carbon_monoxide", 300.0),
            o3=c.get("ozone", 40.0),
        )
    except Exception as exc:
        log.warning("Open-Meteo AQ fetch failed: %s — using defaults", exc)
        return DEFAULT_AQ


def fetch_weather_sync(lat: float, lon: float) -> WeatherData:
    """Synchronous version for non-async contexts."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "wind_speed_10m,wind_direction_10m,temperature_2m,"
                   "relative_humidity_2m,cloud_cover,precipitation",
        "timezone": "auto",
    }
    try:
        resp = httpx.get(OPEN_METEO_WEATHER_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        c = resp.json().get("current", {})
        return WeatherData(
            wind_speed=c.get("wind_speed_10m", 2.0),
            wind_direction=c.get("wind_direction_10m", 0),
            temperature=c.get("temperature_2m", 28),
            humidity=c.get("relative_humidity_2m", 70),
            cloud_cover=c.get("cloud_cover", 50) / 100.0,
            precipitation=c.get("precipitation", 0),
        )
    except Exception as exc:
        log.warning("Open-Meteo weather sync fetch failed: %s", exc)
        return DEFAULT_WEATHER


def fetch_air_quality_sync(lat: float, lon: float) -> AirQualityBaseline:
    """Synchronous version for non-async contexts."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone",
        "timezone": "auto",
    }
    try:
        resp = httpx.get(OPEN_METEO_AQ_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        c = resp.json().get("current", {})
        return AirQualityBaseline(
            pm25=c.get("pm2_5", 20.0),
            pm10=c.get("pm10", 30.0),
            no2=c.get("nitrogen_dioxide", 15.0),
            co=c.get("carbon_monoxide", 300.0),
            o3=c.get("ozone", 40.0),
        )
    except Exception as exc:
        log.warning("Open-Meteo AQ sync fetch failed: %s", exc)
        return DEFAULT_AQ
