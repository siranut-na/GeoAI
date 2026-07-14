#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
สร้าง sentinel2.html : ภาพ Sentinel-2 composite แบบ median ปลอดเมฆ
ขอบเขตประเทศไทย ช่วง 1 ม.ค. 2026 - วันนี้ บนพื้นหลัง Google Maps Satellite

- กรองเมฆด้วย Cloud Score+ (GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED)
- ดึง XYZ tile URL จาก getMapId() แล้วแทรกลงหน้า Leaflet (pattern เดียวกับ Example/Thailand.html)

หมายเหตุ: tile URL จาก getMapId() เป็น token ชั่วคราว (หมดอายุใน ~ไม่กี่ชั่วโมง-วัน)
          หากภาพไม่โหลด ให้รันสคริปต์นี้ใหม่เพื่อ regenerate sentinel2.html
"""
import io
import sys
import ee

# บังคับ stdout เป็น utf-8 กันปัญหา console encoding ภาษาไทยบน Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PROJECT = "siranut-narktap"
START, END = "2026-01-01", "2026-07-15"  # END exclusive -> ครอบถึง 14 ก.ค. 2026
QA_BAND, THRESH = "cs_cdf", 0.60          # Cloud Score+ : เก็บ pixel ที่ cs_cdf >= 0.6
OUT_HTML = "sentinel2.html"


def build_composite():
    ee.Initialize(project=PROJECT)

    # ขอบเขตไทย (server-side, เบา) — ไม่ส่ง geojson 12MB แบบ inline
    thailand = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level0") \
        .filter(ee.Filter.eq("ADM0_NAME", "Thailand"))
    region = thailand.geometry()

    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
          .filterBounds(region)
          .filterDate(START, END))
    csp = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")

    masked = (s2.linkCollection(csp, [QA_BAND])
              .map(lambda img: img.updateMask(img.select(QA_BAND).gte(THRESH))))

    composite = masked.median().clip(region)
    vis = {"bands": ["B4", "B3", "B2"], "min": 0, "max": 3000}  # true color

    n = s2.size().getInfo()
    print(f"image count ({START} .. {END}) = {n}")
    if n == 0:
        raise SystemExit("ไม่พบภาพ Sentinel-2 ในช่วงเวลาที่กำหนด")

    mapid = composite.getMapId(vis)
    tile_url = mapid["tile_fetcher"].url_format
    print("tile url =", tile_url)
    return tile_url


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sentinel-2 Median 2026 (ปลอดเมฆ) — ประเทศไทย</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<style>
  html,body{margin:0;height:100%}
  #map{position:absolute;inset:0}
  .title-box{position:absolute;top:12px;left:50px;z-index:1000;background:rgba(255,255,255,.92);
    padding:8px 14px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.25);
    font-family:'Segoe UI','Sarabun',Tahoma,sans-serif}
  .title-box h1{margin:0;font-size:1rem;color:#1F4E79}
  .title-box p{margin:2px 0 0;font-size:.72rem;color:#5a6b7b}
  .coord{position:absolute;bottom:10px;left:10px;z-index:1000;background:rgba(255,255,255,.9);
    padding:3px 8px;border-radius:6px;font:12px monospace;color:#333}
</style>
</head>
<body>
<div id="map"></div>
<div class="title-box">
  <h1>Sentinel-2 Median 2026 (ปลอดเมฆ) — ประเทศไทย</h1>
  <p>ช่วง 1 ม.ค. – 14 ก.ค. 2026 · median · Cloud Score+ · true color (B4/B3/B2)<br>
     พื้นหลัง: Google Maps Satellite · สลับชั้นแผนที่มุมขวาบน</p>
</div>
<div class="coord" id="coord">lat, lng</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
// ---- Google Maps basemaps (via Google tile servers) ----
const gSubs = ['mt0','mt1','mt2','mt3'];
function gLayer(lyrs){
  return L.tileLayer('https://{s}.google.com/vt/lyrs='+lyrs+'&x={x}&y={y}&z={z}',
    {subdomains:gSubs, maxZoom:20, attribution:'&copy; Google'});
}
const satellite= gLayer('s');
const hybrid   = gLayer('y');
const roadmap  = gLayer('m');
const terrain  = gLayer('p');

// ---- Sentinel-2 median composite (Google Earth Engine tile layer) ----
const s2Layer = L.tileLayer('__TILE_URL__',
  {maxZoom:20, opacity:1.0,
   attribution:'Sentinel-2 / Copernicus · Google Earth Engine'});

const map = L.map('map', {center:[13.03893, 101.49017], zoom:6, layers:[satellite, s2Layer]});

L.control.layers(
  {'Google ดาวเทียม (Satellite)':satellite,'Google ไฮบริด (Hybrid)':hybrid,
   'Google ถนน (Roadmap)':roadmap,'Google ภูมิประเทศ (Terrain)':terrain},
  {'Sentinel-2 Median 2026 (ปลอดเมฆ)':s2Layer},
  {collapsed:false}
).addTo(map);
L.control.scale({imperial:false}).addTo(map);

map.on('mousemove', e=>{
  document.getElementById('coord').textContent =
    e.latlng.lat.toFixed(5)+', '+e.latlng.lng.toFixed(5);
});
</script>
</body>
</html>
"""


def main():
    tile_url = build_composite()
    html = HTML_TEMPLATE.replace("__TILE_URL__", tile_url)
    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"เขียน {OUT_HTML} สำเร็จ")


if __name__ == "__main__":
    main()
