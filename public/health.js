'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const TAGS = ['술', '늦은식사', '카페인', '출장', '아픔', '야근', '낮잠'];
const SHORTCUT_URL = 'shortcuts://run-shortcut?name=%EA%B1%B4%EA%B0%95%20%EC%97%85%EB%A1%9C%EB%93%9C&input=text&text=force';
const fixtureMode = new URLSearchParams(location.search).get('fixture') === '1';
const state = { data: null, wellness: [0, 0, 0, 0], tags: new Set(), toastTimer: 0 };
const isNumberValue = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function formatDate(dateString, withYear = false) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T00:00:00+09:00`);
  return new Intl.DateTimeFormat('ko-KR', withYear ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' } : { month: 'numeric', day: 'numeric' }).format(date);
}

function compactNumber(value) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}분`;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

function formatPace(seconds) {
  if (!Number.isFinite(Number(seconds))) return '--';
  const value = Number(seconds);
  return `${Math.floor(value / 60)}′${String(Math.round(value % 60)).padStart(2, '0')}″`;
}

async function request(method = 'GET', body) {
  const url = method === 'GET' && fixtureMode ? '/health-fixture.json' : '/api/health';
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 401) {
    renderAuth();
    throw new Error('unauthorized');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('응답을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
  if (!response.ok || !result.ok) throw new Error(result.error || '요청을 처리하지 못했어요.');
  return result;
}

async function post(body, successMessage) {
  await request('POST', body);
  toast(successMessage);
  await load();
}

function renderAuth() {
  document.body.innerHTML = '<main class="shell auth"><section class="card auth-card"><div class="auth-mark">[!]</div><h1>인증이 필요해요</h1><p>가계부 인증 링크로 한 번 접속해 주세요.<br>그다음 이 화면을 다시 열면 돼요.</p></section></main>';
}

function sparkline(series, className = 'spark') {
  const values = (series || []).map((point) => Number(point.v ?? point)).filter(Number.isFinite);
  if (!values.length) return `<svg class="${className}" viewBox="0 0 100 36" aria-hidden="true"><path class="grid" d="M0 28H100" /></svg>`;
  const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 50 : index * 100 / (values.length - 1);
    const y = 30 - ((value - min) / spread) * 24;
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1)[0].toFixed(1)} 34 L${points[0][0].toFixed(1)} 34 Z`;
  const last = points.at(-1);
  return `<svg class="${className}" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><path class="grid" d="M0 30H100"/><path class="area" d="${area}"/><path class="line" d="${line}"/><circle class="dot" cx="${last[0]}" cy="${last[1]}" r="2.5"/></svg>`;
}

/* 도트 마스코트. 12x12 격자에 사각형을 찍는다. 원본 도안이며 어떤 상표도 쓰지 않는다. */
const MASCOT_BODY = [
  '....######..',
  '..##########',
  '.############',
  '############',
  '############',
  '############',
  '############',
  '.##########.',
  '..########..',
  '...#....#...',
  '..##....##..',
  '............',
];
const FACES = {
  strong: { eyes: [[4, 3], [7, 3]], brow: [[4, 2], [7, 2]], mouth: [[5, 6], [6, 6], [4, 5], [7, 5]], blush: [[2, 5], [9, 5]] },
  ok: { eyes: [[4, 4], [7, 4]], brow: [], mouth: [[5, 6], [6, 6]], blush: [[2, 5], [9, 5]] },
  light: { eyes: [[4, 4], [7, 4]], brow: [], mouth: [[5, 6], [6, 6], [4, 6], [7, 6]], blush: [] },
  tired: { eyes: [[4, 4], [5, 4], [7, 4], [8, 4]], brow: [], mouth: [[5, 7], [6, 7]], blush: [] },
};
function mascotSvg(band) {
  const key = band === '강하게 해도 됨' ? 'strong' : band === '계획대로' ? 'ok' : band === '가볍게' ? 'light' : 'tired';
  const face = FACES[key];
  const px = [];
  MASCOT_BODY.forEach((rowStr, y) => [...rowStr].forEach((ch, x) => { if (ch === '#') px.push(`<rect class="body" x="${x}" y="${y}" width="1" height="1"/>`); }));
  const dots = (list, cls) => list.map(([x, y]) => `<rect class="${cls}" x="${x}" y="${y}" width="1" height="1"/>`).join('');
  const cls = key === 'tired' ? 'mascot tired' : key === 'strong' ? 'mascot strong' : 'mascot';
  return `<svg class="${cls}" viewBox="0 0 12 12" role="img" aria-label="오늘 상태 ${esc(band || '')}">${px.join('')}${dots(face.blush, 'blush')}${dots(face.brow, 'eye')}${dots(face.eyes, 'eye')}${dots(face.mouth, 'mouth')}</svg>`;
}

function renderAlerts(data) {
  const alerts = Array.isArray(data.alerts) ? data.alerts : [];
  const banners = alerts.map((alert) => `<div class="banner ${alert.level === 'bad' ? 'bad' : ''}">${esc(alert.text)}</div>`);
  if (data.staleness && data.staleness.sleepToday === false) banners.push('<div class="banner info">오늘 수면 데이터가 아직 없어요. 워치 업로드 후 다시 확인해 주세요.</div>');
  $('#alerts').innerHTML = banners.join('');
}

function renderReadiness(readiness = {}) {
  const score = isNumberValue(readiness.score) ? Math.max(0, Math.min(100, Number(readiness.score))) : null;
  $('#readyScore').textContent = score == null ? '--' : Math.round(score);
  const filled = score == null ? 0 : Math.round(score / 10);
  const capped = readiness.band === '휴식' || readiness.band === '가볍게';
  $('#gaugeValue').innerHTML = Array.from({ length: 10 }, (_, i) => `<i class="${i < filled ? (capped ? 'on cap' : 'on') : ''}"></i>`).join('');
  $('#mascot').innerHTML = mascotSvg(readiness.band);
  $('#gauge').setAttribute('aria-label', score == null ? `준비도 ${readiness.band || '기준선 축적 중'}` : `준비도 ${score}점, ${readiness.band}`);
  $('#readyBand').textContent = readiness.band || '기준선 축적 중';
  $('#readyHeadline').textContent = readiness.headline || '기록이 쌓이면 오늘의 강도를 안내해요.';
  const lines = Array.isArray(readiness.lines) ? readiness.lines.slice(0, 3) : [];
  $('#readyLines').innerHTML = lines.length ? lines.map((line) => `<li class="${['good', 'neutral', 'warn', 'bad'].includes(line.tone) ? line.tone : 'neutral'}">${esc(line.text)}</li>`).join('') : '<li>수면과 회복 데이터가 더 필요해요.</li>';
  const components = Array.isArray(readiness.components) ? readiness.components : [];
  $('#componentCount').textContent = components.length ? `${components.length}개 / 가중치 ${Math.round(components.reduce((sum, item) => sum + (Number(item.weight) || 0), 0) * 100)}%` : '';
  $('#components').innerHTML = components.length ? components.map((item) => `<div class="component"><div class="component-top"><strong>${esc(item.label)}</strong><span>${Math.round(Number(item.score) || 0)} / 가중치 ${Math.round((Number(item.weight) || 0) * 100)}%</span></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(item.score) || 0))}%"></i></div><p class="component-text">${esc(item.text)}</p></div>`).join('') : '<p class="empty">구성 항목은 기준선이 쌓이면 보여요.</p>';
}

function doneLabel(item) {
  const watchTypes = ['수영', '걷뛰', '러닝', '달리기', '요가'];
  if (!item.done) return item.rest ? '휴식' : (watchTypes.includes(item.name) ? '대기 / 워치 자동' : '대기 / 직접 기록');
  if (item.doneBy === 'watch') return '완료 / 워치 자동';
  if (item.doneBy === 'log') return '완료 / 직접 기록';
  return '완료';
}

function planDetail(detail, band) {
  if (!detail) return '<div class="plan-detail"><p class="empty">상세 계획을 준비 중이에요.</p></div>';
  const rules = detail.readinessRule || {};
  const ruleKey = Object.prototype.hasOwnProperty.call(rules, band) ? band : '계획대로';
  const cautions = Array.isArray(detail.cautions) ? detail.cautions : [];
  return `<div class="plan-detail"><p class="plan-summary">${esc(detail.summary)}</p><div class="today-rule"><small>오늘 판정: ${esc(ruleKey)}</small><strong>${esc(rules[ruleKey] || '계획대로')}</strong></div><div class="detail-grid"><div class="detail-block"><h4>목표</h4><p>${esc(detail.target)}</p></div><div class="detail-block"><h4>방법</h4><ol class="steps">${(detail.how || []).map((step) => `<li>${esc(step)}</li>`).join('')}</ol></div><div class="detail-block"><h4>진행 규칙</h4><p>${esc(detail.progression)}</p></div><div class="detail-block"><h4>이유</h4><p>${esc(detail.why)}</p></div>${cautions.length ? `<div class="detail-block"><h4>주의</h4><ul class="caution-list">${cautions.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}</div>${detail.logHint ? `<p class="log-hint">기록: ${esc(detail.logHint)}</p>` : ''}</div>`;
}

function renderTodayPlan(plan = {}, band) {
  const week = Array.isArray(plan.week) ? plan.week : [];
  const today = week.find((day) => day.isToday) || week.find((day) => day.date === state.data.today);
  $('#todayDay').textContent = today ? `${today.wd}요일` : '오늘';
  const items = today && Array.isArray(today.items) ? today.items : [];
  if (!items.length) {
    $('#todayItems').innerHTML = '<p class="empty">오늘은 정해진 운동이 없어요. 산책과 회복에 집중해요.</p>';
    return;
  }
  const library = plan.library || {};
  $('#todayItems').innerHTML = items.map((item, index) => {
    const detail = library[item.detailKey] || library[item.name];
    const sub = detail?.target || (item.rest ? '산책은 평소대로' : '상세 계획 확인');
    return `<div class="plan-item${item.done ? ' cleared' : ''}" data-plan="${index}"><button class="plan-toggle" type="button" aria-expanded="false"><span class="plan-icon">${esc(item.rest ? 'OFF' : (String(item.name).length > 2 ? String(item.name).slice(0, 1) : String(item.name)))}</span><span><span class="plan-title">${esc(item.name)}</span><span class="plan-sub">${esc(sub)}</span></span><span class="status-icon ${item.done ? 'done' : ''}">${item.done ? '✓ ' : ''}${esc(doneLabel(item))}<i class="chevron">v</i></span></button>${planDetail(detail, band)}</div>`;
  }).join('');
  $('#todayItems').querySelectorAll('.plan-toggle').forEach((button) => button.addEventListener('click', () => {
    const item = button.closest('.plan-item');
    const open = item.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
  }));
}

function workoutMeta(workout) {
  const parts = [formatDate(workout.date), workout.start, `${compactNumber(workout.minutes)}분`];
  if (workout.distanceText) parts.push(workout.distanceText);
  else if (Number(workout.distanceM) > 0) parts.push(`${compactNumber(workout.distanceM)}m`);
  if (Number(workout.hr) > 0) parts.push(`심박 ${compactNumber(workout.hr)}`);
  return parts.filter(Boolean).join(' / ');
}

function renderWorkouts(workouts) {
  const list = Array.isArray(workouts) ? workouts : [];
  if (!list.length) {
    $('#workoutList').innerHTML = '<p class="empty">최근 14일 운동이 없어요. 워치에서 가져오면 세션이 여기에 보여요.</p>';
    return;
  }
  $('#workoutList').innerHTML = list.map((workout, index) => {
    const hasRpe = isNumberValue(workout.rpe);
    return `<article class="workout-item" data-workout="${index}"><button class="workout-toggle" type="button" ${hasRpe ? '' : 'aria-expanded="false"'}><span><span class="workout-name">${esc(workout.ko || workout.type)}${hasRpe ? '' : '<em class="needs-rpe">RPE 필요</em>'}</span><span class="workout-meta">${esc(workoutMeta(workout))}</span></span>${hasRpe ? `<span class="rpe-result"><strong>${esc(workout.rpe)}</strong><span>RPE${workout.loggedAt ? ` ${esc(String(workout.loggedAt).slice(11, 16))}` : ''}</span></span>` : '<span class="chevron">v</span>'}</button>${hasRpe ? (workout.note ? `<p class="workout-note">${esc(workout.note)}</p>` : '') : `<form class="rpe-form"><div class="rpe-label"><span>힘든 정도</span><span>1 쉬움 / 10 한계</span></div><div class="rpe-scale">${Array.from({ length: 10 }, (_, i) => `<button type="button" data-rpe="${i + 1}">${i + 1}</button>`).join('')}</div><input class="text-field" name="note" maxlength="120" autocomplete="off" placeholder="한 줄 코멘트 (선택)"/><button class="secondary-btn full" type="submit">RPE·코멘트 저장</button></form>`}</article>`;
  }).join('');
  $('#workoutList').querySelectorAll('.workout-item').forEach((item) => {
    const workout = list[Number(item.dataset.workout)];
    if (isNumberValue(workout.rpe)) return;
    const toggle = $('.workout-toggle', item);
    toggle.addEventListener('click', () => { const open = item.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); });
    $('.rpe-scale', item).addEventListener('click', (event) => {
      const button = event.target.closest('[data-rpe]'); if (!button) return;
      item.dataset.rpe = button.dataset.rpe;
      $('.rpe-scale', item).querySelectorAll('button').forEach((el) => el.classList.toggle('on', el === button));
    });
    $('.rpe-form', item).addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!item.dataset.rpe) return toast('힘든 정도를 1~10에서 골라 주세요.');
      const submit = event.currentTarget.querySelector('[type=submit]'); submit.disabled = true;
      try { await post({ action: 'workout_log', id: workout.id, rpe: Number(item.dataset.rpe), note: event.currentTarget.elements.note.value.trim() }, '운동 느낌을 기록했어요.'); }
      catch (error) { toast(error.message); submit.disabled = false; }
    });
  });
}

function renderWellness(wellness = {}) {
  state.wellness = Array.isArray(wellness.today?.values) ? wellness.today.values.slice(0, 4).map(Number) : [0, 0, 0, 0];
  const labels = Array.isArray(wellness.labels) && wellness.labels.length ? wellness.labels : ['수면질', '피로', '스트레스', '근육통'];
  const hints = ['1 못 잤다 / 5 푹 잤다', '1 없음 / 5 심함', '1 없음 / 5 심함', '1 없음 / 5 심함'];
  $('#wellnessStatus').textContent = wellness.today ? `오늘 ${wellness.today.at || ''}에 저장한 값이에요. 다시 저장하면 최신 상태로 반영돼요.` : '네 가지 감각을 10초 안에 남겨요.';
  $('#wellnessRows').innerHTML = labels.slice(0, 4).map((label, index) => {
    const recent = (wellness.recent || []).map((row) => row.values?.[index]).filter(Number.isFinite);
    return `<div class="well-row" data-well="${index}"><div class="well-head"><div><span class="well-label">${esc(label)}</span><span class="well-hint">${hints[index]}</span></div>${sparkline(recent, 'spark well-spark')}</div><div class="scale" aria-label="${esc(label)} 1점부터 5점">${[1, 2, 3, 4, 5].map((value) => `<button type="button" data-value="${value}" class="${state.wellness[index] === value ? 'on' : ''}" aria-pressed="${state.wellness[index] === value}">${value}</button>`).join('')}</div></div>`;
  }).join('');
  $('#wellnessRows').addEventListener('click', wellnessClick, { once: true });
  paintWellnessButton();
}

function wellnessClick(event) {
  const button = event.target.closest('[data-value]');
  if (button) {
    const row = button.closest('[data-well]'); state.wellness[Number(row.dataset.well)] = Number(button.dataset.value);
    row.querySelectorAll('[data-value]').forEach((el) => { const on = el === button; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); });
    paintWellnessButton();
  }
  $('#wellnessRows').addEventListener('click', wellnessClick, { once: true });
}

function paintWellnessButton() { $('#saveWellness').disabled = state.wellness.some((value) => !value); }

function renderWeek(plan = {}) {
  const days = Array.isArray(plan.week) ? plan.week : [];
  $('#weekDone').textContent = `${Number(plan.done) || 0}/${Number(plan.planned) || 0}`;
  $('#weekMeta').textContent = plan.adherence4w == null ? '이번 주 완료' : `완료 / 4주 ${Math.round(plan.adherence4w * 100)}%`;
  if (!days.length) { $('#weekGrid').innerHTML = '<p class="empty">이번 주 계획을 아직 정하지 않았어요.</p>'; return; }
  $('#weekGrid').innerHTML = days.slice(0, 7).map((day) => `<div class="week-day ${day.isToday ? 'today' : ''}"><span class="week-label">${esc(day.wd)}</span><span class="week-date">${esc(String(day.date || '').slice(8))}</span>${(day.items || []).map((item) => { const kind = item.rest ? 'rest' : item.done ? 'done' : day.isPast ? 'missed' : 'future'; return `<span class="week-chip ${kind}" title="${esc(item.name)}">${esc(item.name)}</span>`; }).join('')}</div>`).join('');
}

function renderMetricCard(label, unit, today, series, emptyText) {
  if (!series?.length && today == null) return `<div class="metric"><span class="metric-label">${esc(label)}</span><strong class="metric-value">--</strong><span class="well-hint">${esc(emptyText)}</span></div>`;
  const displayValue = isNumberValue(today) ? today : series?.at(-1)?.v;
  return `<div class="metric"><span class="metric-label">${esc(label)}</span><strong class="metric-value">${isNumberValue(displayValue) ? compactNumber(displayValue) : '--'}<small>${esc(unit)}</small></strong>${sparkline(series)}</div>`;
}

function barChart(rows, valueOf) {
  const values = rows.map(valueOf).map(Number); const max = Math.max(...values, 1);
  return `<div class="bar-chart">${rows.map((row, index) => `<span class="bar-col ${index === rows.length - 1 ? 'current' : ''}"><i style="height:${Math.max(3, values[index] / max * 100)}%" title="${compactNumber(values[index])}"></i><small>${esc(String(row.month || row.week || '').slice(5).replace('-', '/'))}</small></span>`).join('')}</div>`;
}

function renderSleepStages(sleep = {}) {
  const lastNight = sleep.lastNight || {};
  const segments = (Array.isArray(sleep.segments) ? sleep.segments : []).filter((segment) => ['core', 'deep', 'rem', 'awake'].includes(segment.stage) && Number(segment.min) > 0);
  const totalMin = isNumberValue(lastNight.totalMin) ? Number(lastNight.totalMin) : segments.reduce((sum, segment) => sum + Number(segment.min), 0);
  $('#sleepTotal').textContent = totalMin > 0 ? formatMinutes(totalMin) : '기록 없음';
  if (!segments.length) {
    $('#sleepStages').innerHTML = `<div class="sleep-fallback"><strong>${totalMin > 0 ? esc(formatMinutes(totalMin)) : '--'}</strong><span>이 날은 단계 기록이 없어요${sleep.stagesFrom ? `<br>단계 기록은 ${esc(formatDate(sleep.stagesFrom))}부터 있어요.` : ''}</span></div>`;
    return;
  }
  const segmentTotal = segments.reduce((sum, segment) => sum + Number(segment.min), 0);
  let elapsed = 0;
  const rects = segments.map((segment) => {
    const x = elapsed / segmentTotal * 1000;
    const width = Number(segment.min) / segmentTotal * 1000;
    elapsed += Number(segment.min);
    const fill = segment.stage === 'rem' ? 'url(#sleep-rem)' : segment.stage === 'deep' ? 'var(--ink)' : segment.stage === 'core' ? 'var(--shade)' : 'var(--card)';
    return `<rect x="${x.toFixed(2)}" y="1" width="${Math.max(width, 1).toFixed(2)}" height="50" fill="${fill}" stroke="var(--line)" stroke-width="2" vector-effect="non-scaling-stroke"><title>${esc(segment.start)} ${esc(segment.stage)} ${compactNumber(segment.min)}분</title></rect>`;
  }).join('');
  const stages = [
    ['deep', '깊은 수면'],
    ['rem', '렘 수면'],
    ['core', '코어 수면'],
    ['awake', '깨어 있음']
  ];
  const stats = stages.map(([stage, label]) => {
    const minutes = segments.filter((segment) => segment.stage === stage).reduce((sum, segment) => sum + Number(segment.min), 0);
    const percent = segmentTotal ? Math.round(minutes / segmentTotal * 100) : 0;
    return `<div class="stage-stat ${stage}"><span><i aria-hidden="true"></i>${label}</span><strong>${formatMinutes(minutes)} ${percent}%</strong></div>`;
  }).join('');
  const bed = lastNight.bed || segments[0].start || '';
  const wake = lastNight.wake || segments.at(-1).end || '';
  $('#sleepStages').innerHTML = `<svg class="sleep-chart" viewBox="0 0 1000 52" preserveAspectRatio="none" role="img" aria-label="${esc(bed)}부터 ${esc(wake)}까지 수면 단계"><defs><pattern id="sleep-rem" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="var(--card)"></rect><line x1="0" y1="0" x2="0" y2="12" stroke="var(--ink)" stroke-width="4"></line></pattern></defs>${rects}</svg><div class="sleep-axis"><span>${esc(bed)} 취침</span><span>${esc(wake)} 기상</span></div><div class="stage-summary">${stats}</div>`;
}

function loadTone(status) {
  if (status === '과부하') return 'bad';
  if (status === '회복중') return 'warn';
  if (status === '증가' || status === '유지') return 'good';
  return '';
}

function renderTrainingLoad(load = {}) {
  const weeks = Array.isArray(load.weeks) ? load.weeks.filter((row) => isNumberValue(row.load)) : [];
  const status = load.status || '데이터부족';
  const tone = loadTone(status);
  $('#loadStatus').className = `load-status ${tone}`.trim();
  $('#loadStatus').textContent = status;
  $('#loadText').textContent = load.text || (weeks.length ? '내 최근 기록과 부하를 비교해요.' : '운동 기록이 쌓이면 최근 부하를 비교해요.');
  if (!weeks.length) {
    $('#trainingLoad').innerHTML = '<p class="empty">주간 부하 데이터가 아직 없어요. 세션이 쌓이면 12주 흐름과 급성/만성 비율이 보여요.</p>';
    return;
  }
  const values = weeks.map((row) => Number(row.load));
  const max = Math.max(...values, 1);
  const bars = weeks.slice(-12).map((row, index, rows) => {
    const showLabel = index === 0 || index === rows.length - 1 || index % 3 === 0;
    const label = String(row.week || '').slice(5).replace('-', '/');
    return `<span class="bar-col ${index === rows.length - 1 ? 'current' : ''}"><i style="height:${Math.max(3, Number(row.load) / max * 100)}%" title="${compactNumber(row.load)} / ${compactNumber(row.sessions)}회"></i><small>${showLabel ? esc(label) : ''}</small></span>`;
  }).join('');
  const ratio = isNumberValue(load.ratio) ? Number(load.ratio) : null;
  const marker = ratio == null ? '' : `<i class="ratio-marker ${tone}" style="left:${Math.max(0, Math.min(100, ratio / 2 * 100))}%"></i>`;
  $('#trainingLoad').innerHTML = `<div class="subhead"><h3>최근 12주</h3><span>상대 부하</span></div><div class="bar-chart load-chart">${bars}</div><div class="ratio-head"><span>급성/만성 비율</span><strong>${ratio == null ? '--' : compactNumber(ratio)}</strong></div><p class="ratio-values">급성 ${isNumberValue(load.acute) ? compactNumber(load.acute) : '--'} / 만성 ${isNumberValue(load.chronic) ? compactNumber(load.chronic) : '--'}</p><div class="ratio-gauge" aria-label="급성 만성 비율 ${ratio == null ? '데이터 없음' : compactNumber(ratio)}"><i class="ratio-safe"></i>${marker}</div><div class="ratio-scale"><span>0</span><span style="left:40%">0.8</span><span style="left:65%">1.3</span><span>2.0</span></div>`;
}

function signedChange(value) {
  if (!isNumberValue(value)) return '--';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${compactNumber(number)}`;
}

function fitnessPanel(config) {
  const series = Array.isArray(config.data?.series) ? config.data.series.filter((point) => isNumberValue(point.v)) : [];
  const current = isNumberValue(config.data?.current) ? compactNumber(config.data.current) : '--';
  const change = isNumberValue(config.data?.change12mo) ? Number(config.data.change12mo) : null;
  const good = change != null && (config.betterWhen === 'high' ? change >= 0 : change <= 0);
  const monthFirst = series[0]?.month ? String(series[0].month).replace('-', '.') : '';
  const monthLast = series.at(-1)?.month ? String(series.at(-1).month).replace('-', '.') : '';
  const best = isNumberValue(config.data?.best) ? `<p class="fitness-meta">최고 ${compactNumber(config.data.best)} / ${esc(String(config.data.bestMonth || '').replace('-', '.'))}</p>` : '';
  const chart = series.length ? `${sparkline(series, 'spark fitness-spark')}<div class="fitness-months"><span>${esc(monthFirst)}</span><span>${esc(monthLast)}</span></div>` : '<p class="empty">월별 추세가 쌓이면 긴 방향을 보여요.</p>';
  return `<article class="fitness-panel"><div class="fitness-top"><div><strong class="fitness-name">${config.label}</strong><span class="fitness-direction">${config.direction}</span></div><strong class="fitness-current">${current}${config.unit ? `<small>${esc(config.unit)}</small>` : ''}</strong></div><span class="fitness-change ${change == null ? '' : good ? 'good' : 'warn'}">12개월 변화 ${signedChange(change)}</span>${best}${chart}</article>`;
}

function renderFitness(fitness = {}) {
  $('#fitnessBody').innerHTML = fitnessPanel({ label: 'VO2max', direction: '높을수록 좋음', unit: '', betterWhen: 'high', data: fitness.vo2max || {} }) + fitnessPanel({ label: '안정심박', direction: '낮을수록 좋음', unit: '회/분', betterWhen: 'low', data: fitness.restingHr || {} });
}

function renderInsights(insights) {
  const list = Array.isArray(insights) ? insights : [];
  $('#insightCount').textContent = list.length ? `${list.length}개` : '';
  if (!list.length) {
    $('#insightList').innerHTML = '<p class="empty">아직 뚜렷한 패턴이 없어요. 기록이 쌓이면 여기에 생겨요.</p>';
    return;
  }
  $('#insightList').innerHTML = list.map((insight) => {
    const tone = ['good', 'warn', 'bad'].includes(insight.tone) ? insight.tone : '';
    return `<article class="insight ${tone}"><div class="insight-title-row"><h3 class="insight-title">${esc(insight.title)}</h3><span class="strength-label">${esc(insight.strength || '약함')}</span></div><p class="insight-detail">${esc(insight.detail)}</p><details class="insight-evidence"><summary>근거 보기</summary><p>${esc(insight.evidence)}</p></details></article>`;
  }).join('');
}

function renderTrends(data) {
  const metrics = data.metrics || {};
  const sleepSeries = (data.sleep?.recent || []).map((row) => ({ date: row.date, v: row.totalMin }));
  $('#metricGrid').innerHTML = renderMetricCard('수면', '분', data.sleep?.lastNight?.totalMin, sleepSeries, '수면 기록 대기') + renderMetricCard(metrics.hrv?.label || 'HRV', metrics.hrv?.unit || 'ms', metrics.hrv?.today, metrics.hrv?.series, 'HRV 기록 대기') + renderMetricCard(metrics.resting_hr?.label || '안정심박', metrics.resting_hr?.unit || '', metrics.resting_hr?.today, metrics.resting_hr?.series, '심박 기록 대기');
  const swimming = Array.isArray(data.trends?.swimming) ? data.trends.swimming : [];
  const running = Array.isArray(data.trends?.running) ? data.trends.running : [];
  const swim = swimming.length ? `<div class="sport-row"><div class="sport-copy"><strong>수영 거리</strong><span>${compactNumber(swimming.at(-1).distanceM / 1000)}km / ${swimming.at(-1).sessions}회</span></div>${barChart(swimming, (row) => row.distanceM)}</div>` : '<p class="empty">수영 첫 세션이 기록되면 월간 거리가 보여요.</p>';
  const run = running.length ? `<div class="sport-row"><div class="sport-copy"><strong>러닝 페이스</strong><span>${formatPace(running.at(-1).paceSecPerKm)}/km</span></div>${barChart(running, (row) => Math.max(1, 900 - Number(row.paceSecPerKm || 900)))}</div>` : '<p class="empty">러닝은 다음 주부터. 첫 세션이 기록되면 여기 추세가 생겨요.</p>';
  $('#sportTrends').innerHTML = swim + run;
  const load = Array.isArray(data.trends?.load) ? data.trends.load : [];
  $('#loadTrend').innerHTML = load.length ? barChart(load, (row) => row.srpe) : '<p class="load-empty">RPE를 기록하면 주간 훈련 부하가 쌓여요.</p>';
}

function renderCoach(coach) {
  if (!coach) { $('#coachBody').innerHTML = '<p class="empty">주간 리뷰는 한 주가 끝나면 생겨요.</p>'; return; }
  $('#coachWeek').textContent = coach.week ? String(coach.week).replace(/-/g, '.').replace(/\.(\d{2})\.(\d{2}) ~ \d{4}\./, '.$1.$2 ~ ') : '';
  const f = coach.facts || {};
  const stat = (label, value) => `<div class="coach-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const sleepText = f.sleepMean ? `${Math.floor(f.sleepMean / 60)}시간 ${String(f.sleepMean % 60).padStart(2, '0')}분` : '기록 없음';
  const stats = stat('계획', `${f.done ?? 0}/${f.planned ?? 0}`) + stat('세션', `${f.sessions ?? 0}회`) +
    stat('수면 평균', sleepText) + stat('자가평가', f.wellnessDays ? `${f.wellnessDays}일` : '없음');
  const notes = [];
  if (Array.isArray(f.missed) && f.missed.length) notes.push(`빠짐: ${f.missed.join(', ')}`);
  if (Array.isArray(f.pain) && f.pain.length) notes.push(`통증: ${f.pain.map((p) => `${p.site} ${p.level}/10`).join(', ')}`);
  (coach.drift || []).forEach((d) => notes.push(d));
  if (coach.load && coach.load.status) notes.push(`부하 ${coach.load.status}${coach.load.ratio != null ? ` (급성/만성 ${coach.load.ratio})` : ''}`);
  const review = coach.review
    ? `<p class="coach-review ${coach.review.met === true ? 'kept' : coach.review.met === false ? 'missed' : ''}">${esc(coach.review.text)}</p>` : '';
  const a = coach.advice || {};
  const advice = a.text
    ? `<div class="today-rule"><small>${a.committed ? '이번 주 지킬 것' : '이번 주 지킬 것 (제안)'}</small><strong>${esc(a.text)}</strong>${a.why ? `<span class="coach-why">${esc(a.why)}</span>` : ''}</div>` : '';
  const h = coach.history || {};
  const pips = (h.recent || []).map((r) => `<i class="${r.met === true ? 'kept' : r.met === false ? 'missed' : ''}" title="${esc(r.date)} ${esc(r.text)}"></i>`).join('');
  const history = h.judged
    ? `<div class="coach-history"><span>지금까지 제안 ${h.kept}/${h.judged} 지킴</span><div class="pips">${pips}</div></div>`
    : '<p class="coach-history-empty">제안을 지켰는지는 다음 주에 확인해요.</p>';
  $('#coachBody').innerHTML = `<div class="coach-stats">${stats}</div>${notes.length ? `<ul class="coach-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${review}${advice}${history}`;
}

function renderJournal(data) {
  $('#saveJournal').disabled = false;
  state.tags = new Set(data.tags?.today || []);
  $('#tagList').innerHTML = TAGS.map((tag) => `<button type="button" data-tag="${esc(tag)}" class="${state.tags.has(tag) ? 'on' : ''}" aria-pressed="${state.tags.has(tag)}">${esc(tag)}</button>`).join('');
  const recent = [];
  (data.notes || []).slice(0, 3).forEach((note) => recent.push({ date: note.date, text: note.text }));
  (data.tags?.recent || []).slice(0, 3).forEach((row) => recent.push({ date: row.date, text: (row.tags || []).map((tag) => `#${tag}`).join(' ') }));
  recent.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('#recentLog').innerHTML = recent.length ? `<h3>최근 기록</h3>${recent.slice(0, 5).map((item) => `<div class="log-row"><time>${esc(formatDate(item.date))}</time><span>${esc(item.text)}</span></div>`).join('')}` : '<p class="empty">태그나 메모를 남기면 최근 맥락이 여기에 보여요.</p>';
}

function render(data) {
  state.data = data;
  $('#dateLabel').textContent = formatDate(data.today, true);
  $('#syncMark').textContent = fixtureMode ? '샘플 데이터' : (data.staleness?.lastUploadAt ? `${String(data.staleness.lastUploadAt).slice(11)} 업로드` : '동기화됨');
  $('#syncMark').setAttribute('aria-label', fixtureMode ? '샘플 데이터' : '데이터 동기화 완료');
  $('#staleHint').textContent = data.staleness?.hint || '';
  $('#generatedAt').textContent = data.generatedAt ? `마지막 계산 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt))}` : '';
  renderAlerts(data); renderReadiness(data.readiness); renderTodayPlan(data.plan, data.readiness?.band); renderSleepStages(data.sleep); renderWorkouts(data.workouts); renderWellness(data.wellness); renderWeek(data.plan); renderTrainingLoad(data.fitness?.load); renderTrends(data); renderFitness(data.fitness); renderInsights(data.insights); renderCoach(data.coach); renderJournal(data);
  $('#app').setAttribute('aria-busy', 'false');
}

async function load() {
  try { render(await request()); }
  catch (error) { if (error.message !== 'unauthorized') toast(error.message); }
}

$('#watchImport').addEventListener('click', () => { location.href = SHORTCUT_URL; });
$('#saveWellness').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try { await post({ text: `컨디션 ${state.wellness.join(' ')}` }, '컨디션을 저장했어요.'); }
  catch (error) { toast(error.message); paintWellnessButton(); }
});
$('#tagList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]'); if (!button) return;
  const tag = button.dataset.tag; state.tags.has(tag) ? state.tags.delete(tag) : state.tags.add(tag);
  const on = state.tags.has(tag); button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
});
$('#saveJournal').addEventListener('click', async (event) => {
  const memo = $('#memo').value.trim(); const tags = [...state.tags];
  if (!memo && !tags.length) return toast('태그를 고르거나 메모를 적어 주세요.');
  event.currentTarget.disabled = true;
  try {
    if (tags.length) await request('POST', { text: `태그 ${tags.join(' ')}` });
    if (memo) await request('POST', { text: `메모 ${memo}` });
    toast('오늘의 맥락을 저장했어요.'); $('#memo').value = ''; await load();
  } catch (error) { toast(error.message); event.currentTarget.disabled = false; }
});

load();
