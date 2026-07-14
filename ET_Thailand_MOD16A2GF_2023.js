/**********************************************************************
 * วิเคราะห์การคายระเหยน้ำ (Evapotranspiration, ET) ของประเทศไทย ปี 2023
 * ข้อมูล: MODIS/061/MOD16A2GF  (Gap-Filled, ราย 8 วัน, ความละเอียด 500 m)
 *
 * ---------------------------------------------------------------------
 *  ที่มาของสมการ (MOD16 ET Algorithm)
 * ---------------------------------------------------------------------
 *  MOD16 คำนวณ ET จากสมการ Penman–Monteith (PM):
 *
 *          Δ · A  +  ρ · Cp · (e_sat − e) / r_a
 *   λE = ───────────────────────────────────────────
 *              Δ  +  γ · ( 1 + r_s / r_a )
 *
 *   โดย
 *     λE       = ฟลักซ์ความร้อนแฝง (latent heat flux, W m⁻²)  →  แปลงเป็น ET
 *     Δ        = ความชันของเส้นความดันไอน้ำอิ่มตัวต่ออุณหภูมิ (kPa °C⁻¹)
 *     A        = พลังงานสุทธิที่ใช้ได้ (available energy, W m⁻²)
 *     ρ        = ความหนาแน่นของอากาศ (kg m⁻³)
 *     Cp       = ความจุความร้อนจำเพาะของอากาศ (J kg⁻¹ °C⁻¹)
 *     (e_sat−e)= ความพร่องความดันไอน้ำ (vapor pressure deficit, kPa)
 *     γ        = ค่าคงที่ไซโครเมตริก (psychrometric constant, kPa °C⁻¹)
 *     r_a, r_s = ความต้านทานอากาศพลศาสตร์ / พื้นผิว (s m⁻¹)
 *
 *   ET รวม = การระเหยจากดินเปียก + การระเหยจากเรือนยอดเปียก + การคายน้ำของพืช
 *
 *   อ้างอิง:
 *     Mu, Q., Zhao, M., & Running, S.W. (2011). Improvements to a MODIS
 *     global terrestrial evapotranspiration algorithm. Remote Sensing of
 *     Environment, 115(8), 1781–1800. (MOD16 ATBD)
 *
 * ---------------------------------------------------------------------
 *  หน่วยและ scale factor ของแบนด์ 'ET'
 * ---------------------------------------------------------------------
 *   - ค่าดิบเป็นจำนวนเต็ม (int16)  หน่วย kg/m²/8day  (≈ mm/8day)
 *   - scale factor = 0.1  →  ต้องคูณ 0.1 เพื่อได้ mm/8day จริง
 *   - ช่วงค่าที่ถูกต้อง (valid range): −32767 ถึง 32700
 *   - ค่า > 32700 (32761–32767) = fill value (น้ำ/เมฆ/นอกพื้นดิน) ต้อง mask ทิ้ง
 **********************************************************************/


// =====================================================================
// SECTION 1 : ขอบเขตประเทศไทย + simplify กัน projection error
// =====================================================================
// ดึงขอบเขตไทยจากชุดข้อมูลพรมแดนสากล USDOS/LSIB_SIMPLE/2017
var thailand = ee.FeatureCollection('USDOS/LSIB_SIMPLE/2017')
                 .filter(ee.Filter.eq('country_na', 'Thailand'));

// *** จุดกัน error ***: ขอบเขต LSIB มี vertex จำนวนมากและซับซ้อน
// เมื่อนำไป reduceRegion กับข้อมูล MODIS (projection sinusoidal) มักเจอ
// "Too many pixels / geometry too complex". จึง simplify ด้วย maxError 1000 m
// เพื่อลดจำนวนจุดของ polygon ลง โดยยังคงรูปร่างประเทศไว้ใกล้เคียงเดิม
var thaiGeom = thailand.geometry().simplify({maxError: 1000});

// ตั้งจุดกึ่งกลางแผนที่ไปที่ประเทศไทย
Map.centerObject(thaiGeom, 6);


// =====================================================================
// SECTION 2 : เตรียม/ทำความสะอาดคอลเลกชัน ET (mask + scale)
// =====================================================================
// ฟังก์ชันทำความสะอาดแต่ละภาพ: mask fill value แล้วคูณ scale factor
var cleanET = function (img) {
  var et = img.select('ET');

  // *** จุด clamp/กัน error ***: mask ค่าที่ > 32700 (fill value) ออกก่อน
  // เพื่อไม่ให้ค่าขยะ (เช่น 32767) ปนเข้าไปในการรวม/เฉลี่ย
  var masked = et.updateMask(et.lte(32700));

  // แปลงหน่วยด้วย scale factor 0.1  →  mm/8day
  var scaled = masked.multiply(0.1).rename('ET');

  // คงคุณสมบัติเวลาไว้ (system:time_start) เพื่อใช้ทำ time series / chart
  return scaled.copyProperties(img, ['system:time_start']);
};

// โหลดคอลเลกชันปี 2023 เฉพาะแบนด์ ET แล้วทำความสะอาดทั้งชุด
var etCollection = ee.ImageCollection('MODIS/061/MOD16A2GF')
                     .filterDate('2023-01-01', '2024-01-01')
                     .filterBounds(thaiGeom)
                     .map(cleanET);

print('จำนวนภาพ ET ราย 8 วัน ปี 2023:', etCollection.size());


// =====================================================================
// SECTION 3 : แผนที่ ET สะสมรายปี (sum) + clip + ขอบเขตไทย
// =====================================================================
// รวม (sum) ทุกภาพ 8 วันตลอดปี → ET สะสมรายปี (mm/year) แล้ว clip เฉพาะไทย
var etAnnualSum = etCollection.sum().clip(thaiGeom);

// palette แบบ YlGnBu (เหลือง→เขียว→น้ำเงิน) สำหรับปริมาณ ET
var etVis = {
  min: 0,
  max: 1500,
  palette: ['ffffd9', 'edf8b1', 'c7e9b4', '7fcdbb', '41b6c4',
            '1d91c0', '225ea8', '253494', '081d58']
};
Map.addLayer(etAnnualSum, etVis, 'ET สะสมรายปี 2023 (mm/year)');

// วาดขอบเขตไทยเป็นเส้นสีแดง ไม่มีสีพื้น (fillColor โปร่งใส)
var thaiOutline = ee.Image().byte()
                    .paint({featureCollection: thailand, color: 1, width: 2});
Map.addLayer(thaiOutline, {palette: ['FF0000']}, 'ขอบเขตประเทศไทย');


// =====================================================================
// SECTION 4 : Time series ราย 8 วัน (คำนวณ reduceRegion เอง)
// =====================================================================
// *** จุดกัน error สำคัญ ***:
// ห้ามใช้ ui.Chart.image.series() กับ MODIS โดยตรง เพราะ default จะใช้
// projection sinusoidal ของ MODIS แล้วเกิด projection/scale error บ่อยมาก
// วิธีแก้: map ผ่านคอลเลกชันเอง ทำ reduceRegion(mean) โดย "บังคับ"
//   crs 'EPSG:4326', scale 5000, bestEffort true  ทุกครั้ง

var etTimeSeries = etCollection.map(function (img) {
  // เฉลี่ยค่า ET ทั้งประเทศต่อ 1 ช่วง 8 วัน
  var meanDict = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: thaiGeom,
    crs: 'EPSG:4326',   // บังคับ CRS กัน MODIS sinusoidal error
    scale: 5000,        // ขยาย scale ให้พอเหมาะกับพื้นที่ประเทศ (ลดจำนวนพิกเซล)
    bestEffort: true,   // ถ้าพิกเซลเยอะเกิน ให้ปรับ scale อัตโนมัติ ไม่ error
    maxPixels: 1e13
  });

  var etMean = meanDict.get('ET');  // อาจเป็น null ถ้าช่วงนั้นถูก mask หมด

  // สร้าง Feature เก็บ [date (ms), ET] — ยังไม่มี geometry เพื่อความเบา
  return ee.Feature(null, {
    'system:time_start': img.get('system:time_start'),
    'date': ee.Date(img.get('system:time_start')).format('YYYY-MM-dd'),
    'ET': etMean
  });
});

// *** จุดกัน error ***: กรอง Feature ที่ ET เป็น null ออก ก่อนนำไป plot
// (ถ้ามี null ค้างอยู่ chart จะพัง/แสดงเส้นขาด)
var etTimeSeriesClean = ee.FeatureCollection(etTimeSeries)
                          .filter(ee.Filter.notNull(['ET']));

// วาดกราฟเส้นด้วย ui.Chart.feature.byFeature (ไม่ใช้ image.series)
var etChart = ui.Chart.feature.byFeature({
                features: etTimeSeriesClean,
                xProperty: 'system:time_start',
                yProperties: ['ET']
              })
              .setChartType('LineChart')
              .setOptions({
                title: 'ET เฉลี่ยทั้งประเทศไทย ราย 8 วัน (ปี 2023)',
                hAxis: {title: 'วันที่', format: 'MMM'},
                vAxis: {title: 'ET (mm/8day)'},
                lineWidth: 2,
                pointSize: 3,
                colors: ['1d91c0']
              });
print(etChart);


// =====================================================================
// SECTION 5 : ET สะสมเฉลี่ยทั้งประเทศรายปี (ค่าเดียว)
// =====================================================================
// ใช้ภาพ ET สะสมรายปี (จาก SECTION 3) มาหาค่าเฉลี่ยเชิงพื้นที่ทั้งประเทศ
// *** บังคับ crs/scale/bestEffort เหมือน SECTION 4 กัน projection error ***
var etAnnualMeanDict = etAnnualSum.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: thaiGeom,
  crs: 'EPSG:4326',
  scale: 5000,
  bestEffort: true,
  maxPixels: 1e13
});

print('ET สะสมเฉลี่ยทั้งประเทศไทย ปี 2023 (mm/year):',
      etAnnualMeanDict.get('ET'));
