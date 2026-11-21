/* HealthDock 100% Local Browser Streaming Apple Health Parser (Web Worker)
 * Zero network calls. Zero third-party dependencies.
 * Parses Apple Health export.xml (and export.zip via native DecompressionStream) in 4MB chunks
 * and renders English context.md matching HealthDock macOS ContextText.swift + clean CSV/JSON.
 */

'use strict';

const CHUNK_BYTES = 4 * 1024 * 1024;
const PARTIAL_KEYS = new Set(['steps', 'active_kcal', 'exercise_min']);

const METRICS = [
  { key: 'resting_hr_avg', label: 'Resting Heart Rate', labelZh: '静息心率', unit: 'bpm', divisor: 1, decimals: 0, longTerm: true, flagged: true },
  { key: 'hrv_sdnn_ms', label: 'HRV', labelZh: 'HRV', unit: 'ms', divisor: 1, decimals: 0, longTerm: true, flagged: true },
  { key: 'walking_hr_avg', label: 'Walking Heart Rate', labelZh: '步行心率', unit: 'bpm', divisor: 1, decimals: 0, longTerm: false, flagged: true },
  { key: 'sleep_min', label: 'Sleep', labelZh: '睡眠', unit: 'h', divisor: 60, decimals: 1, longTerm: true, flagged: true },
  { key: 'deep_min', label: 'Deep Sleep', labelZh: '深睡', unit: 'min', divisor: 1, decimals: 0, longTerm: false, flagged: true },
  { key: 'rem_min', label: 'REM Sleep', labelZh: 'REM 睡眠', unit: 'min', divisor: 1, decimals: 0, longTerm: false, flagged: true },
  { key: 'steps', label: 'Steps', labelZh: '步数', unit: '', divisor: 1, decimals: 0, longTerm: true, flagged: false },
  { key: 'active_kcal', label: 'Active Energy', labelZh: '活动能量', unit: 'kcal', divisor: 1, decimals: 0, longTerm: false, flagged: false },
  { key: 'exercise_min', label: 'Exercise', labelZh: '锻炼时长', unit: 'min', divisor: 1, decimals: 0, longTerm: false, flagged: false },
  { key: 'spo2_pct', label: 'Blood Oxygen', labelZh: '血氧', unit: '%', divisor: 1, decimals: 1, longTerm: false, flagged: true },
  { key: 'resp_rate', label: 'Respiratory Rate', labelZh: '呼吸频率', unit: '/min', divisor: 1, decimals: 1, longTerm: false, flagged: true },
  { key: 'vo2max', label: 'VO₂max', labelZh: '最大摄氧量', unit: 'ml/kg·min', divisor: 1, decimals: 1, longTerm: true, flagged: false },
  { key: 'bp_sys', label: 'Systolic BP', labelZh: '收缩压', unit: 'mmHg', divisor: 1, decimals: 0, longTerm: false, flagged: true },
  { key: 'bp_dia', label: 'Diastolic BP', labelZh: '舒张压', unit: 'mmHg', divisor: 1, decimals: 0, longTerm: false, flagged: true },
  { key: 'weight_kg', label: 'Weight', labelZh: '体重', unit: 'kg', divisor: 1, decimals: 1, longTerm: true, flagged: false },
];

const WORKOUT_ZH_BY_EN = {
  Archery: '射箭', Badminton: '羽毛球', Basketball: '篮球', Boxing: '拳击', Climbing: '攀岩',
  'Cross Training': '混合训练', Cycling: '骑行', Elliptical: '椭圆机',
  'Functional Strength Training': '功能性力量训练', Hiking: '徒步', 'Martial Arts': '武术',
  'Mind and Body': '身心训练', 'Preparation and Recovery': '热身与恢复', Rowing: '划船',
  Running: '跑步', Soccer: '足球', Squash: '壁球', 'Stair Climbing': '爬楼梯',
  Swimming: '游泳', 'Table Tennis': '乒乓球', Tennis: '网球',
  'Traditional Strength Training': '传统力量训练', Walking: '步行', Yoga: '瑜伽',
  'Core Training': '核心训练', Flexibility: '柔韧训练', HIIT: '高强度间歇训练',
  'Jump Rope': '跳绳', Pilates: '普拉提', 'Mixed Cardio': '混合有氧',
  'Fitness Gaming': '健身游戏', 'Cardio Dance': '有氧舞蹈', Pickleball: '匹克球',
  Cooldown: '整理放松', Other: '其他训练',
};

const RECORD_TYPE_MAP = {
  HKQuantityTypeIdentifierRestingHeartRate: 'resting_hr_avg',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv_sdnn_ms',
  HKQuantityTypeIdentifierWalkingHeartRateAverage: 'walking_hr_avg',
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'active_kcal',
  HKQuantityTypeIdentifierAppleExerciseTime: 'exercise_min',
  HKQuantityTypeIdentifierOxygenSaturation: 'spo2_pct',
  HKQuantityTypeIdentifierRespiratoryRate: 'resp_rate',
  HKQuantityTypeIdentifierVO2Max: 'vo2max',
  HKQuantityTypeIdentifierBloodPressureSystolic: 'bp_sys',
  HKQuantityTypeIdentifierBloodPressureDiastolic: 'bp_dia',
  HKQuantityTypeIdentifierBodyMass: 'weight_kg',
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
};

const WORKOUT_NAMES = {
  HKWorkoutActivityTypeArchery: 'Archery',
  HKWorkoutActivityTypeBadminton: 'Badminton',
  HKWorkoutActivityTypeBasketball: 'Basketball',
  HKWorkoutActivityTypeBoxing: 'Boxing',
  HKWorkoutActivityTypeClimbing: 'Climbing',
  HKWorkoutActivityTypeCrossTraining: 'Cross Training',
  HKWorkoutActivityTypeCycling: 'Cycling',
  HKWorkoutActivityTypeElliptical: 'Elliptical',
  HKWorkoutActivityTypeFunctionalStrengthTraining: 'Functional Strength Training',
  HKWorkoutActivityTypeHiking: 'Hiking',
  HKWorkoutActivityTypeMartialArts: 'Martial Arts',
  HKWorkoutActivityTypeMindAndBody: 'Mind and Body',
  HKWorkoutActivityTypePreparationAndRecovery: 'Preparation and Recovery',
  HKWorkoutActivityTypeRowing: 'Rowing',
  HKWorkoutActivityTypeRunning: 'Running',
  HKWorkoutActivityTypeSoccer: 'Soccer',
  HKWorkoutActivityTypeSquash: 'Squash',
  HKWorkoutActivityTypeStairClimbing: 'Stair Climbing',
  HKWorkoutActivityTypeSwimming: 'Swimming',
  HKWorkoutActivityTypeTableTennis: 'Table Tennis',
  HKWorkoutActivityTypeTennis: 'Tennis',
  HKWorkoutActivityTypeTraditionalStrengthTraining: 'Traditional Strength Training',
  HKWorkoutActivityTypeWalking: 'Walking',
  HKWorkoutActivityTypeYoga: 'Yoga',
  HKWorkoutActivityTypeCoreTraining: 'Core Training',
  HKWorkoutActivityTypeFlexibility: 'Flexibility',
  HKWorkoutActivityTypeHighIntensityIntervalTraining: 'HIIT',
  HKWorkoutActivityTypeJumpRope: 'Jump Rope',
  HKWorkoutActivityTypePilates: 'Pilates',
  HKWorkoutActivityTypeMixedCardio: 'Mixed Cardio',
  HKWorkoutActivityTypeFitnessGaming: 'Fitness Gaming',
  HKWorkoutActivityTypeCardioDance: 'Cardio Dance',
  HKWorkoutActivityTypePickleball: 'Pickleball',
  HKWorkoutActivityTypeCooldown: 'Cooldown',
  HKWorkoutActivityTypeOther: 'Other',
};

const ASLEEP_VALUES = new Set([
  'HKCategoryValueSleepAnalysisAsleep',
  'HKCategoryValueSleepAnalysisAsleepUnspecified',
  'HKCategoryValueSleepAnalysisAsleepCore',
  'HKCategoryValueSleepAnalysisAsleepDeep',
  'HKCategoryValueSleepAnalysisAsleepREM',
]);

let cachedDataset = null;

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.action === 'parse') {
      const started = performance.now();
      const dataset = await parseFile(msg.file);
      dataset.elapsedMs = Math.round(performance.now() - started);
      cachedDataset = dataset;
      const windowDays = msg.windowDays || 90;
      const profile = msg.profile || '';
      const lang = msg.lang || 'en';
      const markdown = renderContextMarkdown(dataset, windowDays, profile, lang);
      self.postMessage({
        type: 'done',
        summary: datasetSummary(dataset),
        markdown,
        dateBounds: dataset.dateBounds,
      });
    } else if (msg.action === 'sample') {
      const started = performance.now();
      const dataset = buildSyntheticDataset();
      dataset.elapsedMs = Math.round(performance.now() - started);
      cachedDataset = dataset;
      const windowDays = msg.windowDays || 90;
      const profile = msg.profile || '';
      const lang = msg.lang || 'en';
      const markdown = renderContextMarkdown(dataset, windowDays, profile, lang);
      self.postMessage({
        type: 'done',
        summary: datasetSummary(dataset),
        markdown,
        dateBounds: dataset.dateBounds,
        isSample: true,
      });
    } else if (msg.action === 'rerender') {
      if (!cachedDataset) return;
      const markdown = renderContextMarkdown(cachedDataset, msg.windowDays || 90, msg.profile || '', msg.lang || 'en');
      self.postMessage({ type: 'rendered', markdown });
    } else if (msg.action === 'export') {
      if (!cachedDataset) {
        self.postMessage({ type: 'error', message: 'Load an export file or click Try Sample Data first.' });
        return;
      }
      const result = buildExportPayload(cachedDataset, msg.options || {});
      self.postMessage({ type: 'exported', ...result });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err && err.message ? err.message : 'Unable to parse this file.',
    });
  }
};

function datasetSummary(ds) {
  return {
    recordsScanned: ds.recordsScanned,
    workoutsCount: ds.workouts.length,
    daysCount: ds.days.length,
    firstDay: ds.dateBounds.min,
    lastDay: ds.dateBounds.max,
    bytesTotal: ds.bytesTotal,
    elapsedMs: ds.elapsedMs,
    sourceLabel: ds.sourceLabel,
  };
}

function createAccumulator() {
  const now = new Date();
  const horizonMs = now.getTime() + 86400 * 1000;
  const horizonDay = formatLocalDate(new Date(horizonMs));
  return {
    now,
    horizonMs,
    horizonDay,
    recordsScanned: 0,
    bytesTotal: 0,
    sourceLabel: '',
    // day -> { sums: { key -> Map<sourceName, number> }, avgs: { key -> { sum, count } }, sleep: Array }
    byDay: new Map(),
    sleepIntervals: [], // { startMs, endMs, stage, source }
    ignoredSleep: Object.create(null),
    workouts: [],
    currentWorkout: null,
  };
}

function getDayBucket(acc, day) {
  let b = acc.byDay.get(day);
  if (!b) {
    b = { sums: Object.create(null), avgs: Object.create(null), workouts: [] };
    acc.byDay.set(day, b);
  }
  return b;
}

function extractAttr(tag, name) {
  const needle = name + '="';
  const i = tag.indexOf(needle);
  if (i === -1) return '';
  const start = i + needle.length;
  const end = tag.indexOf('"', start);
  if (end === -1) return '';
  return tag.slice(start, end);
}

function decodeXmlEntities(str) {
  if (!str || str.indexOf('&') === -1) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseAppleDateMs(str) {
  if (!str || str.length < 19) return NaN;
  // "2026-01-15 07:32:30 +0800" -> "2026-01-15T07:32:30+08:00"
  const datePart = str.slice(0, 10);
  const timePart = str.slice(11, 19);
  const rest = str.slice(20).trim();
  let tz = 'Z';
  if (rest.length === 5 && (rest[0] === '+' || rest[0] === '-')) {
    tz = rest.slice(0, 3) + ':' + rest.slice(3, 5);
  } else if (rest.length === 6 && rest[3] === ':') {
    tz = rest;
  }
  return Date.parse(datePart + 'T' + timePart + tz);
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYMD(ymd) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1;
  const d = Number(ymd.slice(8, 10));
  return new Date(y, m, d, 0, 0, 0, 0);
}

function addDaysYMD(ymd, delta) {
  const dt = parseYMD(ymd);
  dt.setDate(dt.getDate() + delta);
  return formatLocalDate(dt);
}

function processRecordTag(acc, tag) {
  acc.recordsScanned++;
  const type = extractAttr(tag, 'type');
  const metricKey = RECORD_TYPE_MAP[type];
  if (!metricKey) return;

  const startStr = extractAttr(tag, 'startDate');
  if (startStr.length < 10) return;
  const day = startStr.slice(0, 10);

  if (metricKey === 'sleep') {
    const val = extractAttr(tag, 'value');
    if (!ASLEEP_VALUES.has(val)) return;
    const endStr = extractAttr(tag, 'endDate');
    const startMs = parseAppleDateMs(startStr);
    const endMs = parseAppleDateMs(endStr);
    const source = decodeXmlEntities(extractAttr(tag, 'sourceName')).trim() || 'Unknown';
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || startMs < 0 || startMs > acc.horizonMs) {
      acc.ignoredSleep[source] = (acc.ignoredSleep[source] || 0) + 1;
      return;
    }
    // Extract civil local offset from startStr to anchor night windows cleanly to the user's recorded local time
    let stage = 'asleep';
    if (val === 'HKCategoryValueSleepAnalysisAsleepDeep') stage = 'deep';
    else if (val === 'HKCategoryValueSleepAnalysisAsleepREM') stage = 'rem';
    else if (val === 'HKCategoryValueSleepAnalysisAsleepCore') stage = 'core';
    acc.sleepIntervals.push({ startMs, endMs, startStr, endStr, stage });
    return;
  }

  if (day > acc.horizonDay || day < '1970-01-01') return;

  const rawVal = parseFloat(extractAttr(tag, 'value'));
  if (!Number.isFinite(rawVal)) return;
  const unit = extractAttr(tag, 'unit');
  let v = rawVal;

  if (metricKey === 'active_kcal') {
    if (unit === 'kJ') v = v / 4.184;
  } else if (metricKey === 'exercise_min') {
    if (unit === 's') v = v / 60;
  } else if (metricKey === 'spo2_pct') {
    if (v <= 1.5) v = v * 100;
  } else if (metricKey === 'weight_kg') {
    if (unit === 'lb') v = v * 0.45359237;
    else if (unit === 'g') v = v / 1000;
  } else if (metricKey === 'hrv_sdnn_ms') {
    if (unit === 's') v = v * 1000;
  }

  const bucket = getDayBucket(acc, day);
  if (PARTIAL_KEYS.has(metricKey)) {
    const source = decodeXmlEntities(extractAttr(tag, 'sourceName')).trim() || 'Default';
    let bySource = bucket.sums[metricKey];
    if (!bySource) {
      bySource = new Map();
      bucket.sums[metricKey] = bySource;
    }
    bySource.set(source, (bySource.get(source) || 0) + v);
  } else {
    let agg = bucket.avgs[metricKey];
    if (!agg) {
      agg = { sum: 0, count: 0 };
      bucket.avgs[metricKey] = agg;
    }
    agg.sum += v;
    agg.count += 1;
  }
}

function workoutDisplayName(rawType) {
  if (WORKOUT_NAMES[rawType]) return WORKOUT_NAMES[rawType];
  if (rawType && rawType.startsWith('HKWorkoutActivityType')) {
    return rawType
      .slice('HKWorkoutActivityType'.length)
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return rawType || 'Other';
}

function processWorkoutStart(acc, tag, selfClosing) {
  const startStr = extractAttr(tag, 'startDate');
  if (startStr.length < 10) return;
  const day = startStr.slice(0, 10);
  if (day > acc.horizonDay || day < '1970-01-01') return;

  const rawType = extractAttr(tag, 'workoutActivityType');
  let duration = parseFloat(extractAttr(tag, 'duration'));
  const durUnit = extractAttr(tag, 'durationUnit');
  if (!Number.isFinite(duration) || duration <= 0) {
    const s = parseAppleDateMs(startStr);
    const e = parseAppleDateMs(extractAttr(tag, 'endDate'));
    duration = Number.isFinite(s) && Number.isFinite(e) && e > s ? (e - s) / 60000 : 0;
  } else if (durUnit === 's') {
    duration = duration / 60;
  } else if (durUnit === 'hr' || durUnit === 'h') {
    duration = duration * 60;
  }

  let kcal = parseFloat(extractAttr(tag, 'totalEnergyBurned'));
  const kcalUnit = extractAttr(tag, 'totalEnergyBurnedUnit');
  if (Number.isFinite(kcal)) {
    if (kcalUnit === 'kJ') kcal = kcal / 4.184;
  } else {
    kcal = null;
  }

  let distKm = parseFloat(extractAttr(tag, 'totalDistance'));
  const distUnit = extractAttr(tag, 'totalDistanceUnit');
  if (Number.isFinite(distKm)) {
    if (distUnit === 'mi') distKm = distKm * 1.609344;
    else if (distUnit === 'm') distKm = distKm / 1000;
  } else {
    distKm = null;
  }

  const w = {
    date: day,
    start: startStr.slice(0, 19),
    typeName: workoutDisplayName(rawType),
    minutes: duration,
    activeKcal: kcal,
    hrAvg: null,
    distanceKm: distKm,
    source: decodeXmlEntities(extractAttr(tag, 'sourceName')).trim() || 'Unknown',
  };

  if (selfClosing) {
    acc.workouts.push(w);
    getDayBucket(acc, day).workouts.push(w);
  } else {
    acc.currentWorkout = w;
  }
}

function processWorkoutStatsTag(acc, tag) {
  const w = acc.currentWorkout;
  if (!w) return;
  const type = extractAttr(tag, 'type');
  if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
    const sum = parseFloat(extractAttr(tag, 'sum'));
    if (Number.isFinite(sum)) {
      const unit = extractAttr(tag, 'unit');
      w.activeKcal = unit === 'kJ' ? sum / 4.184 : sum;
    }
  } else if (type === 'HKQuantityTypeIdentifierHeartRate') {
    const avg = parseFloat(extractAttr(tag, 'average'));
    if (Number.isFinite(avg) && avg > 0) {
      w.hrAvg = avg;
    }
  } else if (
    type === 'HKQuantityTypeIdentifierDistanceWalkingRunning' ||
    type === 'HKQuantityTypeIdentifierDistanceCycling' ||
    type === 'HKQuantityTypeIdentifierDistanceSwimming'
  ) {
    const sum = parseFloat(extractAttr(tag, 'sum'));
    if (Number.isFinite(sum)) {
      const unit = extractAttr(tag, 'unit');
      if (unit === 'mi') w.distanceKm = sum * 1.609344;
      else if (unit === 'm') w.distanceKm = sum / 1000;
      else w.distanceKm = sum;
    }
  }
}

function closeCurrentWorkout(acc) {
  if (!acc.currentWorkout) return;
  const w = acc.currentWorkout;
  acc.currentWorkout = null;
  acc.workouts.push(w);
  getDayBucket(acc, w.date).workouts.push(w);
}

function feedTextChunk(acc, state, text) {
  let buf = state.tail + text;
  let pos = 0;
  const len = buf.length;

  while (pos < len) {
    const lt = buf.indexOf('<', pos);
    if (lt === -1) {
      state.tail = '';
      return;
    }
    const gt = buf.indexOf('>', lt + 1);
    if (gt === -1) {
      state.tail = buf.slice(lt);
      return;
    }
    const ch1 = buf.charCodeAt(lt + 1);
    // 'R' = 82 (<Record ...), 'W' = 87 (<Workout ... / <WorkoutStatistics ...), '/' = 47 (</Workout>)
    if (ch1 === 82 && buf.startsWith('<Record ', lt)) {
      processRecordTag(acc, buf.slice(lt, gt + 1));
    } else if (ch1 === 87) {
      if (buf.startsWith('<Workout ', lt)) {
        const selfClosing = buf.charCodeAt(gt - 1) === 47;
        processWorkoutStart(acc, buf.slice(lt, gt + 1), selfClosing);
      } else if (acc.currentWorkout && buf.startsWith('<WorkoutStatistics ', lt)) {
        processWorkoutStatsTag(acc, buf.slice(lt, gt + 1));
      }
    } else if (ch1 === 47 && acc.currentWorkout && buf.startsWith('</Workout>', lt)) {
      closeCurrentWorkout(acc);
    }
    pos = gt + 1;
  }
  state.tail = '';
}

/* Merge overlapping sleep intervals per night (18:00 prev day -> 12:00 day), matching SleepMerge.swift */
function mergeIntervalsMinutes(intervals, winStart, winEnd) {
  if (!intervals.length) return 0;
  intervals.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  let total = 0;
  let curS = null;
  let curE = null;
  for (let i = 0; i < intervals.length; i++) {
    const s = Math.max(intervals[i][0], winStart);
    const e = Math.min(intervals[i][1], winEnd);
    if (e <= s) continue;
    if (curE !== null && s <= curE) {
      if (e > curE) curE = e;
    } else {
      if (curS !== null && curE !== null) total += curE - curS;
      curS = s;
      curE = e;
    }
  }
  if (curS !== null && curE !== null) total += curE - curS;
  return Math.round(total / 60000);
}

function applySleepNights(acc) {
  if (!acc.sleepIntervals.length) return;
  // Group candidate intervals by night day (YYYY-MM-DD of the noon-ending day)
  // Using recorded local date & hour directly from Apple Health timestamps avoids browser TZ mismatch!
  const nights = new Map();
  for (const item of acc.sleepIntervals) {
    const startDay = item.startStr.slice(0, 10);
    const endDay = item.endStr.slice(0, 10);
    const startHour = Number(item.startStr.slice(11, 13));
    const endHour = Number(item.endStr.slice(11, 13));
    const candidates = new Set();
    // If interval starts >= 18:00 on startDay, it belongs to startDay + 1 night; if < 12:00, startDay night
    if (startHour >= 18) candidates.add(addDaysYMD(startDay, 1));
    else if (startHour < 12) candidates.add(startDay);
    if (endHour >= 18) candidates.add(addDaysYMD(endDay, 1));
    else if (endHour < 12) candidates.add(endDay);
    if (startDay !== endDay) candidates.add(endDay);

    for (const nightDay of candidates) {
      if (nightDay > acc.horizonDay || nightDay < '1970-01-01') continue;
      // Anchor window in the interval's own timezone offset (from startStr)
      const tz = item.startStr.slice(20).trim() || '+0000';
      const prevDay = addDaysYMD(nightDay, -1);
      const winStart = parseAppleDateMs(`${prevDay} 18:00:00 ${tz}`);
      const winEnd = parseAppleDateMs(`${nightDay} 12:00:00 ${tz}`);
      if (!Number.isFinite(winStart) || !Number.isFinite(winEnd)) continue;
      if (item.endMs > winStart && item.startMs < winEnd) {
        let entry = nights.get(nightDay);
        if (!entry) {
          entry = { winStart, winEnd, asleep: [], deep: [], rem: [] };
          nights.set(nightDay, entry);
        }
        entry.asleep.push([item.startMs, item.endMs]);
        if (item.stage === 'deep') entry.deep.push([item.startMs, item.endMs]);
        else if (item.stage === 'rem') entry.rem.push([item.startMs, item.endMs]);
      }
    }
  }

  for (const [nightDay, entry] of nights.entries()) {
    const sleepMin = mergeIntervalsMinutes(entry.asleep, entry.winStart, entry.winEnd);
    if (sleepMin <= 0) continue;
    const bucket = getDayBucket(acc, nightDay);
    bucket.sleep = {
      sleep_min: sleepMin,
      deep_min: entry.deep.length ? mergeIntervalsMinutes(entry.deep, entry.winStart, entry.winEnd) : null,
      rem_min: entry.rem.length ? mergeIntervalsMinutes(entry.rem, entry.winStart, entry.winEnd) : null,
    };
  }
}

function chooseCumulativeSum(bySource) {
  if (!bySource || bySource.size === 0) return null;
  if (bySource.size === 1) return bySource.values().next().value;
  // Avoid double-counting Apple Watch + iPhone on the same day: prefer Apple Watch total if present, else max source.
  let watchSum = 0;
  let hasWatch = false;
  let maxSingle = 0;
  for (const [src, val] of bySource.entries()) {
    if (val > maxSingle) maxSingle = val;
    if (/watch/i.test(src)) {
      hasWatch = true;
      if (val > watchSum) watchSum = val;
    }
  }
  return hasWatch ? watchSum : maxSingle;
}

function finalizeDataset(acc) {
  closeCurrentWorkout(acc);
  applySleepNights(acc);

  const sortedDays = Array.from(acc.byDay.keys()).sort();
  const days = [];
  for (const date of sortedDays) {
    const b = acc.byDay.get(date);
    const values = Object.create(null);
    for (const key of PARTIAL_KEYS) {
      if (b.sums[key]) {
        const total = chooseCumulativeSum(b.sums[key]);
        if (total !== null && Number.isFinite(total)) values[key] = total;
      }
    }
    for (const key of Object.keys(b.avgs)) {
      const agg = b.avgs[key];
      if (agg.count > 0) values[key] = agg.sum / agg.count;
    }
    if (b.sleep) {
      values.sleep_min = b.sleep.sleep_min;
      if (b.sleep.deep_min !== null) values.deep_min = b.sleep.deep_min;
      if (b.sleep.rem_min !== null) values.rem_min = b.sleep.rem_min;
    }
    if (Object.keys(values).length > 0 || b.workouts.length > 0) {
      days.push({ date, values, workouts: b.workouts });
    }
  }

  return {
    now: acc.now,
    days,
    workouts: acc.workouts.sort((a, b) => (a.start < b.start ? 1 : -1)),
    ignoredSleep: acc.ignoredSleep,
    recordsScanned: acc.recordsScanned,
    bytesTotal: acc.bytesTotal,
    sourceLabel: acc.sourceLabel,
    dateBounds: {
      min: days.length ? days[0].date : '',
      max: days.length ? days[days.length - 1].date : '',
    },
  };
}

/* Minimal zero-dependency ZIP parser for Apple Health export.zip */
async function findExportXmlInZip(file) {
  const tailSize = Math.min(file.size, 65557);
  const tailStart = file.size - tailSize;
  const tailBuf = await file.slice(tailStart, file.size).arrayBuffer();
  const dv = new DataView(tailBuf);

  let eocdOffset = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Could not read ZIP directory. Please unzip export.zip and drop export.xml directly.');
  }

  let cdSize = dv.getUint32(eocdOffset + 12, true);
  let cdOffset = dv.getUint32(eocdOffset + 16, true);

  // Check for ZIP64 EOCD locator right before EOCD
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locPos = eocdOffset - 20;
    if (locPos >= 0 && dv.getUint32(locPos, true) === 0x07064b50) {
      const z64Off = Number(dv.getBigUint64(locPos + 8, true));
      const z64Buf = await file.slice(z64Off, z64Off + 56).arrayBuffer();
      const z64 = new DataView(z64Buf);
      if (z64.getUint32(0, true) === 0x06064b50) {
        cdSize = Number(z64.getBigUint64(40, true));
        cdOffset = Number(z64.getBigUint64(48, true));
      }
    }
  }

  const cdBuf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cd = new DataView(cdBuf);
  const dec = new TextDecoder('utf-8');
  let p = 0;

  while (p + 46 <= cd.byteLength) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let uncompSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOff = cd.getUint32(p + 42, true);

    const name = dec.decode(new Uint8Array(cdBuf, p + 46, nameLen));

    // Parse ZIP64 extra field if needed
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOff === 0xffffffff) {
      let ep = p + 46 + nameLen;
      const eEnd = ep + extraLen;
      while (ep + 4 <= eEnd) {
        const headerId = cd.getUint16(ep, true);
        const dataSize = cd.getUint16(ep + 2, true);
        if (headerId === 0x0001) {
          let cursor = ep + 4;
          if (uncompSize === 0xffffffff && cursor + 8 <= ep + 4 + dataSize) {
            uncompSize = Number(cd.getBigUint64(cursor, true));
            cursor += 8;
          }
          if (compSize === 0xffffffff && cursor + 8 <= ep + 4 + dataSize) {
            compSize = Number(cd.getBigUint64(cursor, true));
            cursor += 8;
          }
          if (localOff === 0xffffffff && cursor + 8 <= ep + 4 + dataSize) {
            localOff = Number(cd.getBigUint64(cursor, true));
          }
          break;
        }
        ep += 4 + dataSize;
      }
    }

    const lower = name.toLowerCase();
    if (!lower.startsWith('__macosx/') && (lower === 'export.xml' || lower.endsWith('/export.xml'))) {
      const lhBuf = await file.slice(localOff, localOff + 30).arrayBuffer();
      const lh = new DataView(lhBuf);
      if (lh.getUint32(0, true) !== 0x04034b50) {
        throw new Error('Malformed ZIP entry for export.xml. Please unzip export.zip and drop export.xml directly.');
      }
      const lhNameLen = lh.getUint16(26, true);
      const lhExtraLen = lh.getUint16(28, true);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      return { name, method, compSize, uncompSize, dataStart };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error('No export.xml found inside this ZIP file. Make sure you selected Apple Health’s export.zip.');
}

async function parseFile(file) {
  if (!file) throw new Error('No file selected.');
  const acc = createAccumulator();
  acc.sourceLabel = file.name;
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  const decoder = new TextDecoder('utf-8');
  const parseState = { tail: '' };
  const started = performance.now();
  let lastProgressAt = 0;

  function emitProgress(doneBytes, totalBytes) {
    const now = performance.now();
    if (now - lastProgressAt < 90 && doneBytes < totalBytes) return;
    lastProgressAt = now;
    const elapsedSec = Math.max(0.05, (now - started) / 1000);
    self.postMessage({
      type: 'progress',
      doneBytes,
      totalBytes,
      percent: totalBytes > 0 ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0,
      recordsScanned: acc.recordsScanned,
      mbPerSec: (doneBytes / (1024 * 1024)) / elapsedSec,
    });
  }

  if (isZip) {
    const entry = await findExportXmlInZip(file);
    acc.bytesTotal = entry.uncompSize || file.size;
    if (entry.method === 0) {
      // Stored uncompressed inside ZIP
      let offset = 0;
      while (offset < entry.compSize) {
        const end = Math.min(offset + CHUNK_BYTES, entry.compSize);
        const chunk = await file.slice(entry.dataStart + offset, entry.dataStart + end).arrayBuffer();
        const text = decoder.decode(chunk, { stream: end < entry.compSize });
        feedTextChunk(acc, parseState, text);
        offset = end;
        emitProgress(offset, entry.compSize);
      }
    } else if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Your browser does not support streaming ZIP decompression. Unzip export.zip and drop export.xml directly.');
      }
      const compressedBlob = file.slice(entry.dataStart, entry.dataStart + entry.compSize);
      const stream = compressedBlob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader();
      let doneBytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        doneBytes += value.byteLength;
        const text = decoder.decode(value, { stream: true });
        feedTextChunk(acc, parseState, text);
        emitProgress(doneBytes, acc.bytesTotal);
      }
      const flush = decoder.decode();
      if (flush) feedTextChunk(acc, parseState, flush);
      emitProgress(acc.bytesTotal, acc.bytesTotal);
    } else {
      throw new Error('Unsupported ZIP compression method. Please unzip export.zip and drop export.xml directly.');
    }
  } else {
    acc.bytesTotal = file.size;
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_BYTES, file.size);
      const chunk = await file.slice(offset, end).arrayBuffer();
      const text = decoder.decode(chunk, { stream: end < file.size });
      feedTextChunk(acc, parseState, text);
      offset = end;
      emitProgress(offset, file.size);
    }
  }

  return finalizeDataset(acc);
}

/* Exact ContextText.swift English Markdown Renderer */
function intRound(x) {
  return Math.round(x);
}

function formatNumber(value, divisor, decimals) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const scaled = value / divisor;
  if (decimals === 0) {
    return intRound(scaled).toLocaleString('en-US');
  }
  return scaled.toFixed(decimals);
}

function metricTitle(m, isZh) {
  const name = isZh ? (m.labelZh || m.label) : m.label;
  return m.unit ? `${name} ${m.unit}` : name;
}

function windowRows(byDate, endDay, days, skip) {
  const result = [];
  for (let offset = skip; offset < days; offset++) {
    const key = addDaysYMD(endDay, -offset);
    const row = byDate.get(key);
    if (row) result.push(row);
  }
  return result;
}

function metricNumbers(rows, key) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i].values[key];
    if (v !== undefined && v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function metricMean(rows, key) {
  const nums = metricNumbers(rows, key);
  if (!nums.length) return null;
  let s = 0;
  for (let i = 0; i < nums.length; i++) s += nums[i];
  return s / nums.length;
}

function deltaText(recent, base) {
  if (recent === null || base === null || base === 0) return '—';
  const pct = intRound(((recent - base) / base) * 100);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `${pct}%`;
  return '+0%';
}

function formatClock(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function renderContextMarkdown(dataset, windowDays, profile, lang) {
  const isZh = lang === 'zh';
  const days = dataset.days;
  if (!days.length) {
    return isZh
      ? '# 我的健康背景（给 AI 参考）\n\n未在该文件中找到可解析的健康数据。\n'
      : '# My Health Context (for AI)\n\nNo health data found in this file.\n';
  }

  const now = dataset.now || new Date();
  const todayStr = formatLocalDate(now);

  // Clone last row if it equals today to drop partial steps/active_kcal/exercise_min (exact ContextText.normalizedRows)
  const rows = days.map((d, idx) => {
    if (idx === days.length - 1 && d.date === todayStr) {
      const vals = Object.assign(Object.create(null), d.values);
      for (const k of PARTIAL_KEYS) delete vals[k];
      return { date: d.date, values: vals, workouts: d.workouts };
    }
    return d;
  });

  const byDate = new Map();
  for (const r of rows) byDate.set(r.date, r);

  const endText = rows[rows.length - 1].date;
  const endDate = parseYMD(endText);
  const todayDate = parseYMD(todayStr);
  const staleDays = Math.round((todayDate - endDate) / 86400000);
  const stale = isZh
    ? (staleDays <= 1 ? '数据最新' : `${staleDays} 天前更新`)
    : (staleDays <= 1 ? 'up to date' : `last synced ${staleDays} days ago`);
  const covered = windowRows(byDate, endText, windowDays, 0).length;
  const clock = formatClock(now);

  const lines = isZh
    ? [
        '# 我的健康背景（给 AI 参考）',
        '',
        '以下是由健康坞（HealthDock）从 Apple 健康数据汇总生成的个人健康背景，供你在回答我的健康问题时参考。',
        '这不是医疗诊断。请明确指出哪些情况值得就医检查，并在数据不足时直接说明。',
        '',
        `数据截至 ${endText}（${stale}）；近 ${windowDays} 天中有 ${covered} 天有记录。生成时间 ${clock}。`,
        '',
      ]
    : [
        '# My Health Context (for AI)',
        '',
        'Below is personal health data summarized from Apple Health by HealthDock. Use it as background when answering my health questions.',
        'This is not a medical diagnosis. Point out what warrants seeing a doctor, and say directly when data is insufficient.',
        '',
        `Data through ${endText} (${stale}); ${covered} of the last ${windowDays} days have data. Generated at ${clock}.`,
        '',
      ];

  const cleanProfile = (profile || '').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (cleanProfile) {
    lines.push(isZh ? '## 关于我（自填）' : '## About Me (self-reported)', '', cleanProfile, '');
  }

  lines.push(
    isZh ? '## 近期与基线对比' : '## Recent vs. Baseline',
    '',
    isZh
      ? `| 指标 | 近 7 天 | 近 30 天 | 近 ${windowDays} 天 | 近 7 天 vs 基线 |`
      : `| Metric | Last 7d | Last 30d | Last ${windowDays}d | 7d vs. Baseline |`,
    '|---|---|---|---|---|'
  );

  const recent = windowRows(byDate, endText, 7, 0);
  const month = windowRows(byDate, endText, 30, 0);
  const span = windowRows(byDate, endText, windowDays, 0);
  const base = windowRows(byDate, endText, windowDays, 7);

  for (const m of METRICS) {
    if (metricNumbers(span, m.key).length === 0) continue;
    const recentMean = metricMean(recent, m.key);
    const monthMean = metricMean(month, m.key);
    const spanMean = metricMean(span, m.key);
    const baseMean = metricMean(base, m.key);
    lines.push(
      `| ${metricTitle(m, isZh)} | ${formatNumber(recentMean, m.divisor, m.decimals)} | ${formatNumber(monthMean, m.divisor, m.decimals)} | ${formatNumber(spanMean, m.divisor, m.decimals)} | ${deltaText(recentMean, baseMean)} |`
    );
  }

  lines.push(
    '',
    isZh
      ? `基线 = 近 ${windowDays} 天扣除最近 7 天。当天尚未结束的步数、活动能量与锻炼时长已自动排除。`
      : `Baseline = last ${windowDays} days excluding the most recent 7 days. Today's partial steps, active energy, and exercise are excluded.`,
    '',
    isZh ? '## 异常日（近 14 天，偏离基线 ≥2 SD）' : '## Unusual Days (last 14 days, ≥2 SD from baseline)',
    ''
  );

  // Flagged unusual days (>= 2 SD from baseline skipping 14d, requiring >= 14 baseline days)
  const baseFlagRows = windowRows(byDate, endText, windowDays, 14);
  const recentFlagRows = windowRows(byDate, endText, 14, 0);
  const flags = [];
  for (const m of METRICS) {
    if (!m.flagged) continue;
    const bNums = metricNumbers(baseFlagRows, m.key);
    if (bNums.length < 14) continue;
    const mu = bNums.reduce((a, b) => a + b, 0) / bNums.length;
    const variance = bNums.reduce((a, b) => a + (b - mu) * (b - mu), 0) / bNums.length;
    const sd = Math.sqrt(variance);
    if (sd <= 0) continue;
    for (const day of recentFlagRows) {
      const val = day.values[m.key];
      if (val === undefined || val === null) continue;
      if (Math.abs(val - mu) / sd >= 2) {
        flags.push({
          date: day.date,
          label: metricTitle(m, isZh),
          value: formatNumber(val, m.divisor, m.decimals),
          base: `${formatNumber(mu, m.divisor, m.decimals)} (±${formatNumber(sd, m.divisor, m.decimals)})`,
        });
      }
    }
  }

  if (!flags.length) {
    lines.push(isZh ? '无。' : 'None.');
  } else {
    flags.sort((a, b) => (b.date.localeCompare(a.date)) || (b.label.localeCompare(a.label)) || (b.value.localeCompare(a.value)));
    lines.push(
      isZh ? '| 日期 | 指标 | 数值 | 基线（±1 SD） |' : '| Date | Metric | Value | Baseline (±1 SD) |',
      '|---|---|---|---|'
    );
    for (const f of flags) {
      lines.push(`| ${f.date} | ${f.label} | ${f.value} | ${f.base} |`);
    }
  }

  // Long-Term Trends (yearly averages, newest 10 years)
  const yearsMap = new Map();
  for (const r of rows) {
    const y = r.date.slice(0, 4);
    let arr = yearsMap.get(y);
    if (!arr) { arr = []; yearsMap.set(y, arr); }
    arr.push(r);
  }
  const shownLongTerm = METRICS.filter((m) => {
    if (!m.longTerm) return false;
    for (const arr of yearsMap.values()) {
      if (metricNumbers(arr, m.key).length > 0) return true;
    }
    return false;
  });
  if (shownLongTerm.length > 0) {
    const header = (isZh ? '| 年份 | ' : '| Year | ') + shownLongTerm.map((m) => metricTitle(m, isZh)).join(' | ') + ' |';
    const sep = '|' + '---|'.repeat(shownLongTerm.length + 1);
    lines.push('', isZh ? '## 长期趋势（年均值）' : '## Long-Term Trends (yearly averages)', '', header, sep);
    const sortedYears = Array.from(yearsMap.keys()).sort((a, b) => b.localeCompare(a)).slice(0, 10);
    for (const y of sortedYears) {
      const arr = yearsMap.get(y);
      const cells = shownLongTerm.map((m) => formatNumber(metricMean(arr, m.key), m.divisor, m.decimals));
      lines.push(`| ${y} | ${cells.join(' | ')} |`);
    }
  }

  // Workouts (last 30 days) & Weekly Training Volume (last 8 weeks)
  lines.push('', isZh ? '## 训练（近 30 天）' : '## Workouts (last 30 days)', '');
  const recent30 = windowRows(byDate, endText, 30, 0);
  const w30 = [];
  for (const r of recent30) for (const w of r.workouts) w30.push(w);

  if (!w30.length) {
    lines.push(isZh ? '暂无训练记录。' : 'No workouts recorded.');
  } else {
    const groups = new Map();
    for (const w of w30) {
      const displayName = isZh ? (WORKOUT_ZH_BY_EN[w.typeName] || w.typeName) : w.typeName;
      let arr = groups.get(displayName);
      if (!arr) { arr = []; groups.set(displayName, arr); }
      arr.push(w);
    }
    const ranked = Array.from(groups.entries()).sort((a, b) => {
      const mA = a[1].reduce((s, w) => s + w.minutes, 0);
      const mB = b[1].reduce((s, w) => s + w.minutes, 0);
      return (mB - mA) || a[0].localeCompare(b[0]);
    });
    lines.push(
      isZh ? '| 类型 | 次数 | 时长（小时） | 平均心率 |' : '| Type | Count | Hours | Avg HR |',
      '|---|---|---|---|'
    );
    for (const [name, list] of ranked) {
      const mins = list.reduce((s, w) => s + w.minutes, 0);
      const hrs = list.filter((w) => w.hrAvg && w.hrAvg > 0).map((w) => w.hrAvg);
      const avgHr = hrs.length ? String(intRound(hrs.reduce((a, b) => a + b, 0) / hrs.length)) : '—';
      lines.push(`| ${name} | ${list.length} | ${(mins / 60).toFixed(1)} | ${avgHr} |`);
    }

    // Weekly Training Volume (last 8 weeks, Monday-anchored)
    const dow = endDate.getDay(); // 0=Sun..6=Sat
    const mondayOffset = (dow + 6) % 7;
    const mondayStr = addDaysYMD(endText, -mondayOffset);
    lines.push(
      '',
      isZh ? '### 每周训练量（近 8 周）' : '### Weekly Training Volume (last 8 weeks)',
      '',
      isZh ? '| 周起始日 | 次数 | 时长（小时） | 训练活动千卡 |' : '| Week Starting | Count | Hours | Workout Active kcal |',
      '|---|---|---|---|'
    );
    for (let i = 0; i < 8; i++) {
      const weekStart = addDaysYMD(mondayStr, -7 * i);
      let count = 0;
      let mins = 0;
      let kcal = 0;
      for (let d = 0; d < 7; d++) {
        const row = byDate.get(addDaysYMD(weekStart, d));
        if (!row) continue;
        for (const w of row.workouts) {
          count++;
          mins += w.minutes;
          kcal += w.activeKcal || 0;
        }
      }
      lines.push(`| ${weekStart} | ${count} | ${(mins / 60).toFixed(1)} | ${intRound(kcal).toLocaleString('en-US')} |`);
    }
  }

  // Data quality line (ignored sleep)
  const ignoredKeys = Object.keys(dataset.ignoredSleep || {}).sort();
  const totalIgnored = ignoredKeys.reduce((s, k) => s + dataset.ignoredSleep[k], 0);
  if (totalIgnored > 0) {
    const parts = ignoredKeys.map((k) => `${k} ${dataset.ignoredSleep[k]}`).join(', ');
    if (isZh) {
      lines.push('', `数据质量：已自动忽略 ${totalIgnored} 条异常睡眠记录（${parts}）。`);
    } else {
      const unit = totalIgnored === 1 ? 'record' : 'records';
      lines.push('', `Data quality: ignored ${totalIgnored} anomalous sleep ${unit} (${parts}).`);
    }
  }

  return lines.join('\n') + '\n';
}

/* CSV / JSON Export Builder */
function csvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildExportPayload(dataset, options) {
  const format = options.format || 'daily-csv';
  const from = options.from || dataset.dateBounds.min;
  const to = options.to || dataset.dateBounds.max;
  const selected = new Set(options.metrics && options.metrics.length ? options.metrics : METRICS.map((m) => m.key));

  if (format === 'workouts-csv') {
    const rows = dataset.workouts.filter((w) => (!from || w.date >= from) && (!to || w.date <= to));
    const headers = ['date', 'start', 'activity_type', 'duration_min', 'active_kcal', 'avg_hr_bpm', 'distance_km', 'source'];
    const csvLines = [headers.join(',')];
    const preview = [];
    for (let i = 0; i < rows.length; i++) {
      const w = rows[i];
      const rec = [
        w.date,
        w.start,
        w.typeName,
        w.minutes.toFixed(1),
        w.activeKcal !== null ? Math.round(w.activeKcal) : '',
        w.hrAvg !== null ? Math.round(w.hrAvg) : '',
        w.distanceKm !== null ? w.distanceKm.toFixed(2) : '',
        w.source,
      ];
      csvLines.push(rec.map(csvCell).join(','));
      if (i < 25) preview.push(rec);
    }
    return {
      format,
      filename: `apple-health-workouts-${from || 'all'}-to-${to || 'latest'}.csv`,
      mime: 'text/csv;charset=utf-8',
      headers,
      preview,
      rowCount: rows.length,
      content: csvLines.join('\n') + '\n',
    };
  }

  const filteredDays = dataset.days.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  const activeMetrics = METRICS.filter((m) => selected.has(m.key));

  if (format === 'daily-json') {
    const out = filteredDays.map((d) => {
      const values = {};
      for (const m of activeMetrics) {
        const v = d.values[m.key];
        if (v !== undefined && v !== null && Number.isFinite(v)) {
          values[m.key] = m.decimals === 0 ? Math.round(v) : Number(v.toFixed(1));
        }
      }
      const entry = { date: d.date, values };
      if (d.workouts.length) {
        entry.workouts = d.workouts.map((w) => ({
          type: w.typeName,
          minutes: Number(w.minutes.toFixed(1)),
          active_kcal: w.activeKcal !== null ? Math.round(w.activeKcal) : undefined,
          hr_avg: w.hrAvg !== null ? Math.round(w.hrAvg) : undefined,
          distance_km: w.distanceKm !== null ? Number(w.distanceKm.toFixed(2)) : undefined,
        }));
      }
      return entry;
    });
    const headers = ['date', ...activeMetrics.map((m) => m.key)];
    const preview = filteredDays.slice(-25).reverse().map((d) => [
      d.date,
      ...activeMetrics.map((m) => formatNumber(d.values[m.key], m.divisor, m.decimals)),
    ]);
    return {
      format,
      filename: `apple-health-daily-${from || 'all'}-to-${to || 'latest'}.json`,
      mime: 'application/json;charset=utf-8',
      headers,
      preview,
      rowCount: out.length,
      content: JSON.stringify({ generated_by: 'HealthDock (local browser tool)', from, to, days: out }, null, 2) + '\n',
    };
  }

  // daily-csv (default)
  const headers = ['date', ...activeMetrics.map((m) => m.key), 'workout_count', 'workout_min'];
  const csvLines = [headers.join(',')];
  const preview = [];
  for (let i = 0; i < filteredDays.length; i++) {
    const d = filteredDays[i];
    const wMin = d.workouts.reduce((s, w) => s + w.minutes, 0);
    const rec = [
      d.date,
      ...activeMetrics.map((m) => {
        const v = d.values[m.key];
        if (v === undefined || v === null || !Number.isFinite(v)) return '';
        if (m.key === 'sleep_min') return Math.round(v);
        return m.decimals === 0 ? Math.round(v) : v.toFixed(m.decimals);
      }),
      d.workouts.length,
      wMin > 0 ? wMin.toFixed(1) : '0',
    ];
    csvLines.push(rec.map(csvCell).join(','));
  }
  const latestDays = filteredDays.slice(-25).reverse();
  for (const d of latestDays) {
    const wMin = d.workouts.reduce((s, w) => s + w.minutes, 0);
    preview.push([
      d.date,
      ...activeMetrics.map((m) => formatNumber(d.values[m.key], m.divisor, m.decimals)),
      d.workouts.length,
      wMin > 0 ? wMin.toFixed(1) : '0',
    ]);
  }
  return {
    format,
    filename: `apple-health-daily-${from || 'all'}-to-${to || 'latest'}.csv`,
    mime: 'text/csv;charset=utf-8',
    headers,
    preview,
    rowCount: filteredDays.length,
    content: csvLines.join('\n') + '\n',
  };
}

/* 100% Synthetic Sample Dataset (never real user data) */
function buildSyntheticDataset() {
  const now = new Date();
  const endDay = formatLocalDate(now);
  // Deterministic PRNG for clean, repeatable demo output
  let seed = 421337;
  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  const days = [];
  const workouts = [];
  const totalDays = 420; // spans ~14 months across 2 years for rich long-term table

  for (let offset = totalDays - 1; offset >= 0; offset--) {
    const date = addDaysYMD(endDay, -offset);
    const dt = parseYMD(date);
    const dow = dt.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isAnomaly = offset === 3; // 3 days ago: poor sleep + elevated RHR + HRV dip

    const baseRhr = 58 + (offset > 200 ? 2 : 0);
    const rhr = isAnomaly ? 68 : baseRhr + (rand() - 0.5) * 3.5;
    const hrv = isAnomaly ? 34 : 58 + (offset > 200 ? -4 : 0) + (rand() - 0.5) * 10;
    const sleepMin = isAnomaly ? 310 : (isWeekend ? 465 : 430) + (rand() - 0.5) * 45;
    const deepMin = Math.round(sleepMin * (isAnomaly ? 0.11 : 0.18 + (rand() - 0.5) * 0.03));
    const remMin = Math.round(sleepMin * (isAnomaly ? 0.16 : 0.22 + (rand() - 0.5) * 0.03));
    const steps = isAnomaly ? 4120 : Math.round((isWeekend ? 10800 : 8600) + (rand() - 0.5) * 3200);
    const activeKcal = Math.round(steps * 0.045 + (rand() * 140));
    const exerciseMin = Math.max(12, Math.round(28 + (rand() - 0.35) * 35));
    const spo2 = 97.6 + (rand() - 0.5) * 1.1;
    const resp = 14.2 + (rand() - 0.5) * 1.1;
    const vo2 = 44.5 + (totalDays - offset) * 0.004 + (rand() - 0.5) * 0.6;
    const weight = 71.8 - (totalDays - offset) * 0.002 + (rand() - 0.5) * 0.5;

    const dayWorkouts = [];
    if (dow === 1 || dow === 3 || dow === 5) {
      const mins = 36 + Math.round(rand() * 14);
      const w = {
        date,
        start: `${date} 07:15:00`,
        typeName: 'Running',
        minutes: mins,
        activeKcal: Math.round(mins * 10.2),
        hrAvg: Math.round(146 + (rand() - 0.5) * 8),
        distanceKm: Number((mins / 5.7).toFixed(2)),
        source: 'Sample Apple Watch',
      };
      dayWorkouts.push(w);
      workouts.push(w);
    } else if (dow === 2 || dow === 4) {
      const mins = 42 + Math.round(rand() * 12);
      const w = {
        date,
        start: `${date} 18:20:00`,
        typeName: 'Traditional Strength Training',
        minutes: mins,
        activeKcal: Math.round(mins * 5.8),
        hrAvg: Math.round(118 + (rand() - 0.5) * 8),
        distanceKm: null,
        source: 'Sample Apple Watch',
      };
      dayWorkouts.push(w);
      workouts.push(w);
    } else if (dow === 6 && offset % 2 === 0) {
      const mins = 65 + Math.round(rand() * 25);
      const w = {
        date,
        start: `${date} 09:00:00`,
        typeName: 'Cycling',
        minutes: mins,
        activeKcal: Math.round(mins * 8.4),
        hrAvg: Math.round(134 + (rand() - 0.5) * 10),
        distanceKm: Number((mins * 0.36).toFixed(2)),
        source: 'Sample Apple Watch',
      };
      dayWorkouts.push(w);
      workouts.push(w);
    }

    const values = {
      resting_hr_avg: rhr,
      hrv_sdnn_ms: hrv,
      walking_hr_avg: 94 + (rand() - 0.5) * 6,
      sleep_min: Math.round(sleepMin),
      deep_min: deepMin,
      rem_min: remMin,
      steps,
      active_kcal: activeKcal,
      exercise_min: exerciseMin,
      spo2_pct: spo2,
      resp_rate: resp,
      vo2max: vo2,
    };
    if (offset % 3 === 0) values.weight_kg = weight;

    days.push({ date, values, workouts: dayWorkouts });
  }

  return {
    now,
    days,
    workouts: workouts.sort((a, b) => (a.start < b.start ? 1 : -1)),
    ignoredSleep: {},
    recordsScanned: 184260,
    bytesTotal: 48 * 1024 * 1024,
    sourceLabel: 'sample-export.xml (synthetic demo)',
    dateBounds: {
      min: days[0].date,
      max: days[days.length - 1].date,
    },
  };
}
