const SPREADSHEET_ID = '1osfDPhPcVegIjTExzsr4a3_xphtZOdbbpnPfl1qdgkE';
const TZ = 'Asia/Seoul';

var SHEET_PREFIX = 'v2_';   // 요청별로 applyProfile_에서 재설정(var: 재할당 허용)
function buildSheets_(p) {
  return {
    fast: p + '빠른입력',
    ledger: p + '거래원장',
    rules: p + '분류규칙',
    assets: p + '자산',
    loans: p + '대출',
    investments: p + '투자',
    report: p + '월간리포트',
    insights: p + '인사이트',
    fixedDefs: p + '고정비',
  };
}
var SHEETS = buildSheets_(SHEET_PREFIX);
// 허용 프로필 → 시트 접두어. 알 수 없는 값은 거부한다(조용히 v2_로 폴백하면
// 브리 앱이 프로필을 잃었을 때 사용자 원장/스냅샷을 덮어쓰는 사고가 난다).
const PROFILE_PREFIX = { '': 'v2_', 'es': 'es_' };

// 프로필별 탭 세트 선택. 유효하면 true, 알 수 없는 프로필이면 false(호출부가 에러 반환).
function applyProfile_(profile) {
  const p = String(profile == null ? '' : profile);
  if (!Object.prototype.hasOwnProperty.call(PROFILE_PREFIX, p)) return false;
  SHEET_PREFIX = PROFILE_PREFIX[p];
  SHEETS = buildSheets_(SHEET_PREFIX);
  return true;
}

const APP_STATE_SHEET = 'AppState';

// 편집 시 자동 갱신을 반응시킬 "데이터 탭" 목록.
// 이 탭들을 고쳤을 때만 인사이트를 다시 계산한다.
const AUTO_REFRESH_SOURCE_SHEETS = [
  SHEETS.ledger, SHEETS.assets, SHEETS.loans, SHEETS.investments, SHEETS.fast,
];

// 빠른입력 텍스트에서 자동 인식할 결제수단 단어 목록.
// 주의: 긴 단어가 먼저 와야 한다. (예: '삼성카드'를 '카드'로 잘못 자르지 않도록)
// alias는 표기가 달라도 같은 결제수단으로 통일하기 위한 것.
const PAYMENT_KEYWORDS = [
  { match: '네이버페이', save: '네이버페이' },
  { match: '카카오페이', save: '카카오페이' },
  { match: '토스페이', save: '토스페이' },
  { match: '당근페이', save: '당근페이' },
  { match: '국민카드', save: '국민카드' },
  { match: '삼성카드', save: '삼성카드' },
  { match: '현대카드', save: '현대카드' },
  { match: '신한카드', save: '신한카드' },
  { match: '하나카드', save: '하나카드' },
  { match: '농협카드', save: 'NH카드' },   // '농협카드'로 써도 'NH카드'로 통일
  { match: '엔에이치카드', save: 'NH카드' },  // 시리 음성: '엔에이치 카드' → NH카드
  { match: 'NH카드', save: 'NH카드' },
  { match: '이음카드', save: '이음카드' },
  { match: '이음', save: '이음카드' },   // 시리 줄임말 '이음' → 이음카드 ('이음카드'보다 뒤에 둬서 긴 것 먼저 매칭)
  { match: '체크카드', save: '체크카드' },
  { match: '계좌이체', save: '계좌이체' },
  { match: '현금', save: '현금' },
  { match: '카드', save: '카드' },   // ponytail: generic '카드' 폴백, 반드시 구체 카드명 뒤(맨 끝). '카드'만 말한 시리 입력의 잔재 방지
];

// 텍스트에서 결제수단 단어를 찾아 빼낸다.
// 찾으면 { payment: '통일된 이름', rest: '결제수단 뺀 나머지 텍스트' } 반환.
function extractPayment_(text) {
  for (const entry of PAYMENT_KEYWORDS) {
    // 키워드 글자 사이에 공백이 있어도 매칭 (시리: '하나 카드' → 하나카드, '엔에이치 카드' → NH카드)
    const pattern = entry.match.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    const re = new RegExp(pattern);
    if (re.test(text)) {
      return {
        payment: entry.save,
        rest: text.replace(re, ' ').replace(/\s+/g, ' ').trim(),
      };
    }
  }
  return { payment: '', rest: text };
}

// 시트를 열 때 자동 실행되는 특수 함수(GAS 예약 이름).
// 상단에 '📊 가계부' 커스텀 메뉴를 만든다.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 가계부')
    .addItem('인사이트 새로고침', 'rebuildV2Insights')
    .addItem('월간리포트 새로고침', 'refreshV2Report')
    .addSeparator()
    .addItem('자동 갱신 켜기', 'enableAutoRefresh')
    .addItem('자동 갱신 끄기', 'disableAutoRefresh')
    .addToUi();
}

// 셀을 편집할 때 자동 실행되는 특수 함수(GAS 예약 이름).
// 단, 자동 갱신이 '켜짐' 상태이고, 데이터 탭을 편집했을 때만 동작한다.
function onEdit(e) {
  if (!e || !e.range) return;

  // 자동 갱신 스위치가 꺼져 있으면 아무것도 안 함
  const enabled = PropertiesService.getDocumentProperties().getProperty('autoRefresh');
  if (enabled !== 'on') return;

  // 인사이트/리포트 등 결과 탭을 편집한 경우는 무시 (무한 갱신 방지)
  const editedSheet = e.range.getSheet().getName();
  if (!AUTO_REFRESH_SOURCE_SHEETS.includes(editedSheet)) return;

  rebuildV2Insights();
}

// 자동 갱신 켜기 (스위치를 문서 속성에 'on'으로 저장)
function enableAutoRefresh() {
  PropertiesService.getDocumentProperties().setProperty('autoRefresh', 'on');
  SpreadsheetApp.getActiveSpreadsheet().toast('데이터 탭을 편집하면 인사이트가 자동 갱신됩니다.', '자동 갱신 켜짐', 5);
}

// 자동 갱신 끄기
function disableAutoRefresh() {
  PropertiesService.getDocumentProperties().setProperty('autoRefresh', 'off');
  SpreadsheetApp.getActiveSpreadsheet().toast('자동 갱신을 멈췄습니다. 메뉴에서 수동으로 새로고침하세요.', '자동 갱신 꺼짐', 5);
}

function setupV2() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  setupSheet_(ss, SHEETS.fast, FAST_HEADERS);

  setupSheet_(ss, SHEETS.ledger, LEDGER_HEADERS);

  setupRules_(ss);
  setupAssets_(ss);
  setupLoans_(ss);
  setupInvestments_(ss);
  setupReport_(ss);

  SpreadsheetApp.flush();
}

function migrateExistingTransactions() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const ledger = ensureSheet_(ss, SHEETS.ledger);
  const output = [];
  const ignored = Object.values(SHEETS);

  for (const sheet of ss.getSheets()) {
    const name = sheet.getName();
    if (ignored.includes(name) || name === '고정비 ') continue;

    const values = sheet.getDataRange().getValues();
    if (!values.length) continue;

    const modernHeaderRow = findHeaderRow_(values, '대분류');
    if (modernHeaderRow >= 0) {
      const header = values[modernHeaderRow];
      const idx = makeIndex_(header);

      for (let r = modernHeaderRow + 1; r < values.length; r++) {
        const row = values[r];
        const amount = Number(row[idx['금액']]) || 0;
        const memo = row[idx['내역']];
        if (!amount || !memo) continue;

        const date = normalizeDate_(row[idx['날짜']], name);
        const split = Number(row[idx['분담금']]) || 0;
        const type = row[idx['구분']] || '지출';

        output.push([
          Utilities.getUuid(),
          new Date(),
          date,
          date.slice(0, 7),
          type,
          row[idx['고정/변동']] || '',
          row[idx['대분류']] || '미분류',
          row[idx['소분류']] || '',
          memo,
          amount,
          row[idx['결제수단']] || '',
          row[idx['비고(태그)']] || '',
          split || '',
          type === '지출' ? amount - split : amount,
          'migration',
          name,
          r + 1,
          ''
        ]);
      }

      continue;
    }

    const oldHeaderRow = findHeaderRow_(values, '항목');
    if (oldHeaderRow >= 0) {
      const header = values[oldHeaderRow];
      const idx = makeIndex_(header);

      for (let r = oldHeaderRow + 1; r < values.length; r++) {
        const row = values[r];
        const amount = Number(row[idx['금액']]) || 0;
        const memo = row[idx['항목']];
        if (!amount || !memo) continue;

        const date = normalizeDate_(row[idx['날짜']], name);
        const rule = classify_(ss, memo);
        const type = row[idx['구분']] || '지출';
        const nature = String(row[idx['성격']] || '');
        const fixedType = nature.includes('고정') ? '고정' : nature.includes('변동') ? '변동' : (rule.fixedType || '');

        output.push([
          Utilities.getUuid(),
          new Date(),
          date,
          date.slice(0, 7),
          type,
          fixedType,
          rule.mainCategory || nature || '미분류',
          rule.subCategory || row[idx['현금흐름']] || '',
          memo,
          amount,
          row[idx['결제수단']] || '',
          row[idx['태그']] || rule.tags || '',
          '',
          amount,
          'migration',
          name,
          r + 1,
          ''
        ]);
      }
    }
  }

  if (ledger.getLastRow() > 1) {
    ledger.getRange(2, 1, ledger.getLastRow() - 1, ledger.getLastColumn()).clearContent();
  }

  if (output.length) {
    ledger.getRange(2, 1, output.length, output[0].length).setValues(output);
  }

  SpreadsheetApp.flush();
  return `Migrated ${output.length} rows`;
}

function refreshV2Report() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  setupReport_(ss);
  SpreadsheetApp.flush();
}

function resizeAllV2ColumnsForHeaders() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ss.getSheets()
    .filter(sheet => sheet.getName().startsWith('v2_'))
    .forEach(resizeSheetColumnsForHeaders_);
}

function resizeActiveSheetColumnsForHeaders() {
  resizeSheetColumnsForHeaders_(SpreadsheetApp.getActiveSheet());
}

function removeMisroutedAssetInvestmentRows() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureSheet_(ss, SHEETS.ledger);
  const values = sheet.getDataRange().getValues();

  for (let r = values.length - 1; r >= 1; r--) {
    const memo = String(values[r][8] || '');
    const raw = String(values[r][17] || '');
    if (/^\s*(자산|주식|투자)\s*[:：]/.test(memo) || /^\s*(자산|주식|투자)\s*[:：]/.test(raw)) {
      sheet.deleteRow(r + 1);
    }
  }
}

function reprocessSpecialFastInputs() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureSheet_(ss, SHEETS.fast);
  const values = sheet.getDataRange().getValues();
  let processed = 0;

  for (let r = 1; r < values.length; r++) {
    const raw = String(values[r][1] || '').trim();
    if (!/^\s*(자산|주식|투자)\s*[:：]/.test(raw)) continue;

    const date = normalizeFastInputDate_(values[r][3]);

    if (/^\s*자산\s*[:：]/.test(raw)) {
      const parsed = parseAssetText_(raw);
      if (!parsed.amount || !parsed.assetType) continue;

      upsertAsset_(ss, {
        date,
        type: parsed.assetType,
        name: parsed.name,
        institution: parsed.institution,
        amount: parsed.amount,
        profit: '',
        memo: raw,
      });

      sheet.getRange(r + 1, 3, 1, 12).setValues([[
        '재처리완료', date, '자산', parsed.amount, parsed.name, parsed.institution,
        '', parsed.assetType, '', '#자산', '', 'reprocessSpecialFastInputs'
      ]]);
      processed++;
      continue;
    }

    if (/^\s*(주식|투자)\s*[:：]/.test(raw)) {
      const rows = parseInvestmentText_(raw);
      rows.forEach(row => upsertInvestment_(ss, {
        date,
        account: row.account || '일반',
        market: '',
        symbol: '',
        name: row.name,
        quantity: '',
        averagePrice: '',
        manualValue: row.amount,
        manualReturn: row.returnRate,
        memo: raw,
      }));

      if (rows.length) {
        updateInvestmentAssetSummary_(ss, date);
        sheet.getRange(r + 1, 3, 1, 12).setValues([[
          '재처리완료', date, '투자', rows.reduce((sum, row) => sum + row.amount, 0),
          `${rows.length}개 종목`, '', '', '주식', '', '#투자', '',
          'reprocessSpecialFastInputs'
        ]]);
        processed++;
      }
    }
  }

  SpreadsheetApp.flush();
  return `Reprocessed ${processed} fast input rows`;
}

function rebuildInvestmentsFromFastInputs() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const fast = ensureSheet_(ss, SHEETS.fast);
  const investment = ensureSheet_(ss, SHEETS.investments);
  const fastValues = fast.getDataRange().getValues();
  const output = [];

  ensureInvestmentHeaders_(investment);
  clearSheetBody_(investment);

  for (let r = 1; r < fastValues.length; r++) {
    const raw = String(fastValues[r][1] || '').trim();
    if (!/^\s*(주식|투자)\s*[:：]/.test(raw)) continue;

    const date = normalizeFastInputDate_(fastValues[r][3]);
    const rows = parseInvestmentText_(raw);

    rows.forEach(row => {
      output.push([
        date,
        row.account || '일반',
        '',
        '',
        row.name,
        '',
        '',
        row.amount,
        row.returnRate,
        '',
        '',
        '',
        '',
        '빠른입력 재구성'
      ]);
    });
  }

  if (output.length) {
    investment.getRange(2, 1, output.length, output[0].length).setValues(output);
  }

  fillInvestmentFormulas_(investment, 2, Math.max(200, output.length + 10));
  updateInvestmentAssetSummary_(ss, output.length ? output[0][0] : formatDate_(new Date()));
  resizeSheetColumnsForHeaders_(investment);
  SpreadsheetApp.flush();

  return `Rebuilt ${output.length} investment rows`;
}

function upgradeInvestmentAutomation() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureSheet_(ss, SHEETS.investments);
  const oldValues = sheet.getDataRange().getValues();
  const oldHeaders = oldValues[0] || [];
  const oldIndex = makeIndex_(oldHeaders);
  const rebuilt = [];

  for (let r = 1; r < oldValues.length; r++) {
    const row = oldValues[r];
    const name = row[oldIndex['종목명']];
    if (!name) continue;

    rebuilt.push([
      row[oldIndex['기준일']] || formatDate_(new Date()),
      row[oldIndex['계좌']] || '',
      row[oldIndex['시장']] || '',
      row[oldIndex['종목코드']] || '',
      name,
      row[oldIndex['수량']] || '',
      row[oldIndex['평균단가']] || '',
      row[oldIndex['수동평가금액']] || row[oldIndex['평가금액']] || '',
      row[oldIndex['수동수익률']] || row[oldIndex['수익률']] || row[oldIndex['평가손익']] || '',
      '',
      '',
      '',
      '',
      row[oldIndex['메모']] || '',
    ]);
  }

  ensureInvestmentHeaders_(sheet);
  clearSheetBody_(sheet);
  if (rebuilt.length) {
    sheet.getRange(2, 1, rebuilt.length, rebuilt[0].length).setValues(rebuilt);
  }
  fillInvestmentFormulas_(sheet, 2, Math.max(200, rebuilt.length + 10));
  updateInvestmentAssetSummary_(ss, formatDate_(new Date()));
  resizeSheetColumnsForHeaders_(sheet);
  resizeSheetColumnsForHeaders_(ensureSheet_(ss, SHEETS.assets));
  SpreadsheetApp.flush();

  return `Upgraded ${rebuilt.length} investment rows`;
}

function getRecentMonths_(ledgerRows, limit = 6) {
  return [...new Set(
    ledgerRows.map(r => normalizeMonth_(r['월'])).filter(Boolean)
  )]
    .sort()
    .slice(-limit);
}

function average_(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function getMonthlyAverageSpend_(ledgerRows, limit = 6) {
  const months = getRecentMonths_(ledgerRows, limit);

  const spends = months.map(month => {
    return getMonthMetrics_(ledgerRows, month).realSpend;
  });

  return average_(spends);
}

function getCategoryAverage_(ledgerRows, category, limit = 6) {
  const months = getRecentMonths_(ledgerRows, limit);

  const values = months.map(month => {
    const rows = ledgerRows.filter(r =>
      normalizeMonth_(r['월']) === month &&
      r['대분류'] === category &&
      r['구분'] === '지출'
    );

    return sumBy_(rows, '금액');
  });

  return average_(values);
}

function buildCategoryInsights_(ledgerRows, currentMonthRows) {
  const categories = [...new Set(
    currentMonthRows.map(r => r['대분류'])
  )];

  const insights = [];

  categories.forEach(category => {
    const current = sumBy_(
      currentMonthRows.filter(r => r['대분류'] === category),
      '금액'
    );

    const avg = getCategoryAverage_(ledgerRows, category);

    if (!avg) return;

    const diff = (current - avg) / avg;

    if (Math.abs(diff) < 0.2) return;

    insights.push({
      category,
      current,
      avg,
      diff,
      message:
        diff > 0
          ? `${category} 지출이 평균 대비 ${formatPercent_(diff)} 증가`
          : `${category} 지출이 평균 대비 ${formatPercent_(Math.abs(diff))} 감소`
    });
  });

  return insights.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

function detectRiskSignals_(current, avgSpend, fixedRatio, topInvestmentShare) {
  const risks = [];

  if (fixedRatio > 0.6) {
    risks.push('고정비 비중이 높습니다.');
  }

  if (current.realSpend > avgSpend * 1.3) {
    risks.push('평균 대비 과소비 상태입니다.');
  }

  if (topInvestmentShare > 0.45) {
    risks.push('투자 종목 집중도가 높습니다.');
  }

  if (current.variable > current.fixed * 1.5) {
    risks.push('변동지출 비중이 높습니다.');
  }

  return risks;
}

function calculateFinanceScore_(current, fixedRatio, savingsRate, topInvestmentShare) {
  let score = 100;

  if (fixedRatio > 0.6) score -= 20;
  if (savingsRate < 0.1) score -= 25;
  if (topInvestmentShare > 0.45) score -= 15;
  if (current.variable > current.fixed * 1.5) score -= 10;

  return Math.max(0, score);
}

function buildRecommendations_(insights, risks) {
  const lines = [];

  insights.forEach(i => {
    if (i.diff > 0.3) {
      lines.push(`${i.category} 소비 증가 원인 점검 필요`);
    }
  });

  risks.forEach(risk => {
    if (risk.includes('고정비')) {
      lines.push('구독/통신/대출 재점검 추천');
    }

    if (risk.includes('과소비')) {
      lines.push('다음 달 예산 제한 추천');
    }

    if (risk.includes('집중도')) {
      lines.push('투자 리밸런싱 고려');
    }
  });

  return [...new Set(lines)];
}

function rebuildV2Insights() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureSheet_(ss, SHEETS.insights);
  const ledgerRows = readObjects_(ensureSheet_(ss, SHEETS.ledger));
  const assetRows = readObjects_(ensureSheet_(ss, SHEETS.assets));
  const loanRows = readObjects_(ensureSheet_(ss, SHEETS.loans));
  const investmentRows = readObjects_(ensureSheet_(ss, SHEETS.investments));

  const months = [...new Set(ledgerRows.map(row => normalizeMonth_(row['월'])).filter(Boolean))].sort();
  const targetMonth = months[months.length - 1] || Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const prevMonth = months.length > 1 ? months[months.length - 2] : '';
  const current = getMonthMetrics_(ledgerRows, targetMonth);
  const previous = prevMonth ? getMonthMetrics_(ledgerRows, prevMonth) : null;
  const assetTotal = sumBy_(assetRows, '금액');
  const debtTotal = sumBy_(loanRows, '현재잔액');
  const netWorth = assetTotal - debtTotal;
  const investmentTotal = sumBy_(investmentRows, '평가금액');
  const categoryTotals = groupSum_(current.rows, '대분류', '금액');
  const prevCategoryTotals = previous ? groupSum_(previous.rows, '대분류', '금액') : [];
  const categoryDeltas = buildGroupDeltas_(categoryTotals, prevCategoryTotals);
  const paymentTotals = groupSum_(current.rows, '결제수단', '금액');
  const dataQuality = buildDataQualityRows_(ledgerRows, current.rows, investmentRows, assetRows, loanRows);
  const topInvestments = investmentRows
    .filter(row => number_(row['평가금액']))
    .sort((a, b) => number_(b['평가금액']) - number_(a['평가금액']))
    .slice(0, 5);
  const losingInvestments = investmentRows
    .filter(row => investmentRate_(row) < 0)
    .sort((a, b) => investmentRate_(a) - investmentRate_(b))
    .slice(0, 5);
  const topInvestmentShare = investmentTotal && topInvestments.length
    ? number_(topInvestments[0]['평가금액']) / investmentTotal
    : 0;

  // --- v3 분석 엔진: 모든 원본 데이터(ledgerRows, current, assetTotal, topInvestmentShare)가
  //     준비된 이 지점부터 계산해야 ReferenceError가 안 난다. ---
  const avgSpend = getMonthlyAverageSpend_(ledgerRows);
  const categoryInsights = buildCategoryInsights_(ledgerRows, current.rows);
  const fixedRatio = current.totalSpend ? current.fixed / current.totalSpend : 0;
  const savingsRate = assetTotal ? (assetTotal - current.realSpend) / assetTotal : 0;
  const risks = detectRiskSignals_(current, avgSpend, fixedRatio, topInvestmentShare);
  const financeScore = calculateFinanceScore_(current, fixedRatio, savingsRate, topInvestmentShare);
  const recommendations = buildRecommendations_(categoryInsights, risks);

  resetInsightSheet_(sheet);
  drawDashboardTitle_(sheet, targetMonth);

  const spendDiff = previous ? current.realSpend - previous.realSpend : 0;
  drawKpiCard_(sheet, 4, 1, '실지출', current.realSpend, previous ? `${prevMonth} 대비 ${formatSignedMoney_(spendDiff)}` : '비교월 없음', spendDiff <= 0 ? '#d9ead3' : '#f4cccc');
  drawKpiCard_(sheet, 4, 3, '총지출', current.totalSpend, `정산 제외 ${formatMoney_(current.split)}`, '#d9ead3');
  drawKpiCard_(sheet, 4, 5, '고정비 비중', current.totalSpend ? current.fixed / current.totalSpend : 0, `고정 ${formatMoney_(current.fixed)}`, current.totalSpend && current.fixed / current.totalSpend > 0.6 ? '#fff2cc' : '#d9ead3', '0.0%');
  drawKpiCard_(sheet, 4, 7, '순자산', netWorth, `자산 ${formatMoney_(assetTotal)} / 부채 ${formatMoney_(debtTotal)}`, netWorth >= 0 ? '#d9ead3' : '#f4cccc');
  drawKpiCard_(sheet, 4, 9, '투자 평가액', investmentTotal, `자산 대비 ${formatPercent_(assetTotal ? investmentTotal / assetTotal : 0)}`, '#d9ead3');
  drawKpiCard_(sheet, 4, 11, '거래 건수', current.count, `${targetMonth} 지출 기록`, '#cfe2f3', '0');
  drawKpiCard_(sheet, 4, 13, '월 평균 소비', avgSpend, '최근 6개월 기준', '#d9ead3');
  drawKpiCard_(sheet, 4, 15, '재무 점수', financeScore, '100점 기준', financeScore >= 80 ? '#d9ead3' : '#f4cccc', '0');

  const insightLines = buildDashboardInsightLines_({
    targetMonth,
    realSpend: current.realSpend,
    prevMonth,
    prevRealSpend: previous ? previous.realSpend : 0,
    totalSpend: current.totalSpend,
    fixed: current.fixed,
    variable: current.variable,
    split: current.split,
    categoryTotals,
    categoryDeltas,
    debtTotal,
    netWorth,
    investmentTotal,
    topInvestmentShare,
    dataQuality,
  });

  drawSection_(sheet, 9, 1, 5, '자동 판단');
  sheet.getRange(10, 1, insightLines.length, 5).setValues(insightLines.map(line => [line, '', '', '', '']));
  sheet.getRange(10, 1, insightLines.length, 5).mergeAcross().setWrap(true).setVerticalAlignment('middle');

  drawSection_(sheet, 9, 7, 6, '이번 달 액션');
  const actionLines = buildActionLines_(dataQuality, categoryDeltas, losingInvestments, topInvestmentShare, current);
  sheet.getRange(10, 7, actionLines.length, 6).setValues(actionLines.map(line => [line, '', '', '', '', '']));
  sheet.getRange(10, 7, actionLines.length, 6).mergeAcross().setWrap(true).setVerticalAlignment('middle');

  const trendRows = months.slice(-6).map(month => {
    const metric = getMonthMetrics_(ledgerRows, month);
    return [month, metric.totalSpend, metric.split, metric.realSpend, metric.fixed, metric.variable, metric.count];
  });
  writeTableBlock_(sheet, 18, 1, '월별 흐름', ['월', '총지출', '정산', '실지출', '고정비', '변동비', '건수'], trendRows, {
    moneyColumns: [2, 3, 4, 5, 6],
    numberColumns: [7],
  });

  const categoryRows = categoryTotals.slice(0, 8).map(([name, amount]) => {
    const prev = groupValue_(prevCategoryTotals, name);
    return [name, amount, current.totalSpend ? amount / current.totalSpend : 0, prev ? amount - prev : amount];
  });
  writeTableBlock_(sheet, 18, 9, '카테고리 TOP', ['대분류', '금액', '비중', '전월차'], categoryRows, {
    moneyColumns: [2, 4],
    percentColumns: [3],
  });

  const deltaRows = categoryDeltas.slice(0, 8).map(row => [row.name, row.current, row.previous, row.delta]);
  writeTableBlock_(sheet, 31, 1, '전월 대비 증가 카테고리', ['대분류', '이번 달', '전월', '증감'], deltaRows, {
    moneyColumns: [2, 3, 4],
  });

  const paymentRows = paymentTotals.slice(0, 8).map(([name, amount]) => [name, amount, current.totalSpend ? amount / current.totalSpend : 0]);
  writeTableBlock_(sheet, 31, 6, '결제수단 TOP', ['결제수단', '금액', '비중'], paymentRows, {
    moneyColumns: [2],
    percentColumns: [3],
  });

  const qualityRows = dataQuality.map(row => [row.level, row.item, row.count, row.action]);
  writeTableBlock_(sheet, 31, 9, '데이터 품질', ['상태', '항목', '건수', '조치'], qualityRows, {
    numberColumns: [3],
  });

  if (topInvestments.length) {
    const investmentRowsForTable = topInvestments.map(row => [
      row['계좌'],
      row['종목명'],
      number_(row['평가금액']),
      investmentRate_(row),
      investmentTotal ? number_(row['평가금액']) / investmentTotal : 0,
    ]);
    writeTableBlock_(sheet, 44, 1, '투자 비중 TOP 5', ['계좌', '종목명', '평가금액', '수익률', '비중'], investmentRowsForTable, {
      moneyColumns: [3],
      percentColumns: [4, 5],
    });
  }

  if (losingInvestments.length) {
    const lossRows = losingInvestments.map(row => [
      row['계좌'],
      row['종목명'],
      number_(row['평가금액']),
      investmentRate_(row),
    ]);
    writeTableBlock_(sheet, 44, 7, '손실률 점검', ['계좌', '종목명', '평가금액', '수익률'], lossRows, {
      moneyColumns: [3],
      percentColumns: [4],
    });
  }

  const loanRowsForTable = loanRows
    .filter(row => number_(row['현재잔액']) || number_(row['월상환액']))
    .map(row => [
      row['이름'],
      row['기관'],
      number_(row['현재잔액']),
      number_(row['월상환액']),
      row['상환일'],
      row['상태'],
    ]);
  writeTableBlock_(sheet, 57, 1, '대출 상태', ['이름', '기관', '잔액', '월상환액', '상환일', '상태'], loanRowsForTable, {
    moneyColumns: [3, 4],
  });

  // --- v3 추가 테이블: 소비 패턴 분석 / 위험 신호 / 추천 액션 ---
  const insightRows = categoryInsights.map(i => [i.category, i.current, i.avg, i.diff, i.message]);
  writeTableBlock_(sheet, 70, 1, '소비 패턴 분석', ['카테고리', '이번달', '평균', '차이', '인사이트'], insightRows, {
    moneyColumns: [2, 3],
    percentColumns: [4],
  });

  const riskRows = risks.map(r => [r]);
  writeTableBlock_(sheet, 70, 8, '위험 신호', ['내용'], riskRows);

  const recRows = recommendations.map(r => [r]);
  writeTableBlock_(sheet, 82, 1, '추천 액션', ['추천'], recRows);

  sheet.setFrozenRows(7);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 17).setFontFamily('Arial');
  sheet.setColumnWidths(1, 17, 140);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(7, 170);
  sheet.setColumnWidth(10, 130);
  sheet.setColumnWidth(12, 170);
  SpreadsheetApp.flush();
}

function repairV2All() {
  removeMisroutedAssetInvestmentRows();
  upgradeInvestmentAutomation();
  reprocessSpecialFastInputs();
  refreshV2Report();
  rebuildV2Insights();
  resizeAllV2ColumnsForHeaders();
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!applyProfile_(params.profile)) return json_({ ok: false, error: 'unknown_profile' });
  if (params.action === 'load') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const state = readAppState_(ss);
    return json_({ ok: true, store: state.store, updatedAt: state.updatedAt });
  }
  if (params.action === 'ledger') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    return json_({ ok: true, transactions: readLedgerTransactions_(ss) });
  }
  // 시간 트리거가 조용히 죽는 경우가 있어 수동으로 돌릴 통로를 둔다.
  if (params.action === 'autopost') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_({ ok: true, result: autoPostFixed_() });
  }
  if (params.action === 'fixedList') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_({ ok: true, defs: readFixedDefs_(SpreadsheetApp.openById(SPREADSHEET_ID)) });
  }
  // 단축어(iOS/맥)용 GET 입력: ?action=add&token=...&raw=오늘 5000 점심밥
  // POST는 GAS가 GET 전용 주소로 302 리다이렉트해서 단축어에서 깨지므로, GET으로 받는다.
  if (params.action === 'add') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return handleQuickText_(SpreadsheetApp.openById(SPREADSHEET_ID), params);
  }
  // 건강(애플워치→iOS 단축어). POST는 302로 깨지므로 add와 같이 GET.
  // ?action=health&token=..&type=sleep&rows=시작|종료|값%0A시작|종료|값...
  if (params.action === 'health') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(healthAppend_(params.type, params.rows));
  }
  if (params.action === 'healthAll') {   // 모든 탭의 최근 N일 행을 한 번에 (MCP 리포트용)
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_({ ok: true, tabs: healthAll_(Number(params.days) || 7) });
  }
  if (params.action === 'inventory') {   // 가계부 시트 탭 현황(읽기 전용): 이름·행·열·마지막 행 날짜 후보·숨김 여부
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tabs = ss.getSheets().map(sh => {
      const rows = sh.getLastRow(), cols = sh.getLastColumn();
      const head = rows ? sh.getRange(1, 1, 1, Math.min(cols, 12)).getValues()[0].map(String) : [];
      let lastDate = '';
      if (rows > 1) {
        const tail = sh.getRange(Math.max(2, rows - 4), 1, Math.min(5, rows - 1), Math.min(cols, 12)).getValues().flat();
        tail.forEach(v => { if (v instanceof Date && !isNaN(v)) { const d = Utilities.formatDate(v, TZ, 'yyyy-MM-dd'); if (d > lastDate) lastDate = d; } else if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) { const d = String(v).slice(0, 10); if (d > lastDate) lastDate = d; } });
      }
      return { name: sh.getName(), rows, cols, hidden: sh.isSheetHidden(), lastDate, head };
    });
    return json_({ ok: true, spreadsheet: ss.getName(), tabs });
  }
  // 옛 수기 가계부 탭 보관: step=copy(보관 시트로 복사) | delete(대조 후 원본 삭제) | reorder(남은 탭 정렬)
  if (params.action === 'archiveLegacy') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(archiveLegacy_(String(params.step || 'copy')));
  }
  if (params.action === 'healthDrop') {   // 잡탭 삭제(허용 목록만)
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    const ss = healthSpreadsheet_(); const sh = ss.getSheetByName(String(params.name || ''));
    if (!sh || !['zz_test', '시트1'].includes(sh.getName())) return json_({ ok: false, error: 'not_allowed' });
    ss.deleteSheet(sh); return json_({ ok: true, dropped: params.name });
  }
  if (params.action === 'healthCompact') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(healthCompact_(params.type));
  }
  if (params.action === 'healthRows') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_({ ok: true, rows: healthRows_(params.type, Number(params.days) || 7) });
  }
  return json_({ ok: true, message: 'ManageMoney quick input is alive' });
}

function doPost(e) {
  const body = parseBody_(e);
  if (!applyProfile_(body && body.profile)) return json_({ ok: false, error: 'unknown_profile' });
  if (body && body.action === 'save') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    const storeJson = String(body.store || '');
    // Google Sheets 셀은 약 50,000자 한도 → 초과 시 조용히 잘리지 않도록 거부
    if (storeJson.length > 45000) return json_({ ok: false, error: 'store_too_large' });
    const ssSave = SpreadsheetApp.openById(SPREADSHEET_ID);
    const updatedAt = body.updatedAt || new Date().toISOString();
    writeAppState_(ssSave, storeJson, updatedAt);
    return json_({ ok: true, updatedAt });
  }

  if (body && body.action === 'assignCategory') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    const ssA = SpreadsheetApp.openById(SPREADSHEET_ID);
    return json_(assignCategory_(ssA, String(body.id || ''), String(body.category || ''), String(body.subCategory || ''), String(body.memo || '')));
  }

  if (body && body.action === 'fixedSave') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(saveFixedDef_(SpreadsheetApp.openById(SPREADSHEET_ID), body.def || {}));
  }
  if (body && body.action === 'fixedDelete') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(deleteFixedDef_(SpreadsheetApp.openById(SPREADSHEET_ID), String(body.id || '')));
  }

  // 앱에서 원장 거래를 삭제/수정/추가 (단일 원천 = 거래원장)
  if (body && body.action === 'deleteLedger') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(deleteLedgerRow_(SpreadsheetApp.openById(SPREADSHEET_ID), String(body.id || '')));
  }
  if (body && body.action === 'updateLedger') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(updateLedgerRow_(SpreadsheetApp.openById(SPREADSHEET_ID), body.tx || {}));
  }
  if (body && body.action === 'batchReclassify') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(batchReclassify_(SpreadsheetApp.openById(SPREADSHEET_ID), body.items || []));
  }
  // 건강 데이터 대량 적재(과거 내보내기 백필). 단축어는 GET(action=health), 스크립트는 POST.
  if (body && body.action === 'health') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(healthAppend_(body.type, body.rows));
  }
  if (body && body.action === 'appendLedger') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(appendLedgerRow_(SpreadsheetApp.openById(SPREADSHEET_ID), body.tx || {}));
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return handleQuickText_(ss, body);
}

// 원장에서 거래ID로 행을 찾아 삭제. 원장에 없으면(로컬 전용 거래) deleted:0으로 ok.
function deleteLedgerRow_(ss, id) {
  if (!id) return { ok: false, error: 'no id' };
  var sheet = ss.getSheetByName(SHEETS.ledger);
  if (!sheet) return { ok: false, error: 'no ledger' };
  var values = sheet.getDataRange().getValues();
  var cId = makeIndex_(values[0])['거래ID'];
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][cId]) === String(id)) {
      sheet.deleteRow(r + 1);
      SpreadsheetApp.flush();
      return { ok: true, deleted: 1 };
    }
  }
  return { ok: true, deleted: 0 };
}

function setCell_(sheet, rowNum, idx, header, value) {
  if (idx[header] === undefined) return;
  sheet.getRange(rowNum, idx[header] + 1).setValue(value);
}

// 원장 거래를 거래ID로 찾아 모든 필드 갱신(금액/날짜/내역/분류/결제수단/고정변동/분담금). 월·실지출 재계산.
function updateLedgerRow_(ss, tx) {
  var id = String(tx.id || '');
  if (!id) return { ok: false, error: 'no id' };
  var sheet = ss.getSheetByName(SHEETS.ledger);
  if (!sheet) return { ok: false, error: 'no ledger' };
  var values = sheet.getDataRange().getValues();
  var idx = makeIndex_(values[0]);
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idx['거래ID']]) === id) {
      var rowNum = r + 1;
      var type = tx.type === 'income' ? '수입' : '지출';
      var amount = Number(tx.amount) || 0;
      var split = Number(tx.split) || 0;
      var date = String(tx.date || '');
      setCell_(sheet, rowNum, idx, '날짜', date);
      setCell_(sheet, rowNum, idx, '월', date.slice(0, 7));
      setCell_(sheet, rowNum, idx, '구분', type);
      setCell_(sheet, rowNum, idx, '고정/변동', tx.fixedType === 'fixed' ? '고정' : '변동');
      setCell_(sheet, rowNum, idx, '대분류', String(tx.category || ''));
      setCell_(sheet, rowNum, idx, '소분류', String(tx.subCategory || ''));
      setCell_(sheet, rowNum, idx, '내역', String(tx.memo || ''));
      setCell_(sheet, rowNum, idx, '금액', amount);
      setCell_(sheet, rowNum, idx, '결제수단', String(tx.payment || ''));
      setCell_(sheet, rowNum, idx, '분담금', split || '');
      setCell_(sheet, rowNum, idx, '실지출', type === '지출' ? amount - split : amount);
      SpreadsheetApp.flush();
      return { ok: true, updated: 1 };
    }
  }
  return { ok: true, updated: 0 };
}

// 여러 거래의 대분류/소분류만 한 번에 갱신. items = [{id, category, subCategory}, ...].
// 시트 1회 읽기 → 대상 셀만 setValue → 1회 flush. 순차 updateLedger 대비 훨씬 빠르다.
function batchReclassify_(ss, items) {
  if (!items || !items.length) return { ok: true, updated: 0 };
  var sheet = ss.getSheetByName(SHEETS.ledger);
  if (!sheet) return { ok: false, error: 'no ledger' };
  var values = sheet.getDataRange().getValues();
  var idx = makeIndex_(values[0]);
  var cId = idx['거래ID'], cBig = idx['대분류'], cSub = idx['소분류'];
  var rowById = {};
  for (var r = 1; r < values.length; r++) rowById[String(values[r][cId])] = r + 1;
  var n = 0, miss = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i], rowNum = rowById[String(it.id || '')];
    if (!rowNum) { miss++; continue; }
    sheet.getRange(rowNum, cBig + 1).setValue(String(it.category || ''));
    sheet.getRange(rowNum, cSub + 1).setValue(String(it.subCategory || ''));
    n++;
  }
  SpreadsheetApp.flush();
  return { ok: true, updated: n, missed: miss };
}

// 앱 거래를 원장에 추가. 앱의 id를 그대로 써서 중복 병합 가능. 같은 id 있으면 추가 안 함.
function appendLedgerRow_(ss, tx) {
  var id = String(tx.id || '') || Utilities.getUuid();
  var sheet = ledgerSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var cId = makeIndex_(values[0])['거래ID'];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][cId]) === id) return { ok: true, appended: 0, id: id };
  }
  var type = tx.type === 'income' ? '수입' : '지출';
  var amount = Number(tx.amount) || 0;
  var split = Number(tx.split) || 0;
  var date = String(tx.date || formatDate_(new Date()));
  sheet.appendRow([
    id, new Date(), date, date.slice(0, 7), type, tx.fixedType === 'fixed' ? '고정' : '변동',
    String(tx.category || '미분류'), String(tx.subCategory || ''), String(tx.memo || ''), amount,
    String(tx.payment || ''), String(tx.tags || ''), split || '', type === '지출' ? amount - split : amount,
    'app', '', '', String(tx.raw || '')
  ]);
  SpreadsheetApp.flush();
  return { ok: true, appended: 1, id: id };
}

// 빠른입력 텍스트(raw)를 파싱·분류해서 빠른입력 탭+거래원장에 기록한다.
// doPost(JSON 본문)와 doGet(?action=add, 쿼리 파라미터) 양쪽에서 호출한다.
// body는 { raw, token, amount?, type?, memo?, payment?, split?, date?, note? ... } 형태.
function handleQuickText_(ss, body) {
  // 단축어(iOS)가 공백을 %20 글자 그대로 보내는 경우 공백으로 복원
  const raw = String(body.raw || body.text || body.content || '').trim().replace(/%20/g, ' ');

  if (/^\{[\s\S]*"(action|token)"\s*:/.test(raw)) {
    return json_({ ok: false, error: 'ignored_api_body' });
  }

  if (/^\s*자산\s*[:：]/.test(raw)) {
    return handleAssetInput_(ss, raw, body);
  }

  if (/^\s*(주식|투자)\s*[:：]/.test(raw)) {
    return handleInvestmentInput_(ss, raw, body);
  }

  const parsed = parseQuickText_(raw, body);
  const rule = classify_(ss, parsed.memo);

  parsed.mainCategory = body.mainCategory || parsed.mainCategory || rule.mainCategory || '미분류';
  parsed.subCategory = body.subCategory || parsed.subCategory || rule.subCategory || '';
  parsed.fixedType = body.fixedType || parsed.fixedType || rule.fixedType || '변동';
  parsed.tags = body.tags || parsed.tags || rule.tags || '';

  const status = parsed.amount && parsed.memo ? '완료' : '확인필요';
  const now = new Date();
  const month = parsed.date.slice(0, 7);
  const split = Number(body.split || body.share || parsed.split || 0) || 0;
  const realSpend = parsed.type === '지출' ? parsed.amount - split : parsed.amount;

  fastSheet_(ss).appendRow([
    now, raw, status, parsed.date, parsed.type, parsed.amount || '', parsed.memo,
    parsed.payment, parsed.fixedType, parsed.mainCategory, parsed.subCategory,
    parsed.tags, split || '', body.note || ''
  ]);

  if (status === '완료') {
    ledgerSheet_(ss).appendRow([
      Utilities.getUuid(), now, parsed.date, month, parsed.type, parsed.fixedType,
      parsed.mainCategory, parsed.subCategory, parsed.memo, parsed.amount,
      parsed.payment, parsed.tags, split || '', realSpend, 'mobile', '', '', raw
    ]);
  }

  return json_({ ok: true, status, parsed });
}

function handleAssetInput_(ss, raw, body) {
  const now = new Date();
  const date = body.date || formatDate_(now);
  const parsed = parseAssetText_(raw);
  const status = parsed.amount && parsed.assetType ? '완료' : '확인필요';

  fastSheet_(ss).appendRow([
    now, raw, status, date, '자산', parsed.amount || '', parsed.name || '',
    parsed.institution || '', '', parsed.assetType || '미분류', '', '#자산', '', body.note || ''
  ]);

  if (status === '완료') {
    upsertAsset_(ss, {
      date,
      type: parsed.assetType,
      name: parsed.name,
      institution: parsed.institution,
      amount: parsed.amount,
      profit: '',
      memo: raw,
    });
  }

  return json_({ ok: true, status, target: SHEETS.assets, parsed });
}

function handleInvestmentInput_(ss, raw, body) {
  const now = new Date();
  const date = body.date || formatDate_(now);
  const rows = parseInvestmentText_(raw);
  const status = rows.length ? '완료' : '확인필요';

  fastSheet_(ss).appendRow([
    now, raw, status, date, '투자', rows.reduce((sum, row) => sum + row.amount, 0) || '',
    `${rows.length}개 종목`, '', '', '주식', '', '#투자', '', body.note || ''
  ]);

  rows.forEach(row => upsertInvestment_(ss, {
    date,
    account: row.account || '일반',
    symbol: '',
    market: '',
    name: row.name,
    quantity: '',
    averagePrice: '',
    currentPrice: '',
    manualValue: row.amount,
    manualReturn: row.returnRate,
    memo: raw,
  }));

  if (rows.length) updateInvestmentAssetSummary_(ss, date);

  return json_({ ok: true, status, target: SHEETS.investments, count: rows.length, rows });
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return { raw: e.postData.contents };
  }
}

function parseQuickText_(raw, body) {
  let text = raw.replace(/\s+/g, ' ').trim();
  var forcedIncome = /^\+/.test(text);   // 맨 앞 '+'면 수입
  text = text.replace(/^\+\s*/, '');
  let date = new Date();

  const ymd = text.match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  const md = text.match(/(^|\s)(\d{1,2})[.\/-](\d{1,2})(\s|$)/);

  if (/어제/.test(text)) {
    date.setDate(date.getDate() - 1);
    text = text.replace('어제', '').trim();
  }
  if (/오늘/.test(text)) {
    text = text.replace('오늘', '').trim();
  }
  if (ymd) {
    date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    text = text.replace(ymd[0], '').trim();
  } else if (md) {
    date = new Date(date.getFullYear(), Number(md[2]) - 1, Number(md[3]));
    text = text.replace(md[0], ' ').trim();
  }

  // 금액 뒤 '원'/'₩'까지 함께 매칭해서 메모에 '원'이 남지 않게 한다.
  const amountMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원?/);
  const amount = body.amount
    ? Number(body.amount)
    : amountMatch
      ? Number(amountMatch[1].replace(/,/g, ''))
      : 0;

  if (amountMatch) text = text.replace(amountMatch[0], ' ').trim();
  // 시리가 단독으로 넣은 '원'/'₩' 토큰 제거 (단어 안의 '원'(병원 등)은 보존)
  text = text.replace(/(^|\s)[₩원](\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

  // 남은 텍스트에서 결제수단 단어를 찾아 빼낸다.
  // body.payment가 명시적으로 넘어오면 그걸 우선한다.
  const { payment: detectedPayment, rest } = extractPayment_(text);
  text = rest;

  return {
    date: formatDate_(date),
    type: body.type || ((forcedIncome || /수입|입금|월급|급여/.test(raw)) ? '수입' : '지출'),
    amount,
    memo: body.memo || text,
    payment: body.payment || body.pay || detectedPayment || '',
  };
}

function parseAssetText_(raw) {
  const text = raw.replace(/^\s*자산\s*[:：]\s*/, '').replace(/\s+/g, ' ').trim();
  const amountMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d+)/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
  const beforeAmount = amountMatch ? text.slice(0, amountMatch.index).trim() : text;
  const afterAmount = amountMatch ? text.slice(amountMatch.index + amountMatch[0].length).trim() : '';
  const assetType = beforeAmount || '현금';
  const institution = afterAmount || assetType;
  const name = institution || assetType;

  return { assetType, name, institution, amount };
}

function parseInvestmentText_(raw) {
  const normalized = raw.replace(/^\s*(주식|투자)\s*[:：]\s*/, '');
  const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const rows = [];
  let account = '';

  lines.forEach(line => {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    const amountMatch = cleaned.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*([+-]?\d+(?:\.\d+)?)\s*%?/);

    if (!amountMatch) {
      account = cleaned.replace(/[:：]\s*$/, '');
      return;
    }

    const amount = Number(amountMatch[1].replace(/,/g, ''));
    const returnRate = `${amountMatch[2]}%`;
    const name = cleaned
      .slice(0, amountMatch.index)
      .replace(/[:：]\s*$/, '')
      .trim();

    if (!name || !amount) return;

    rows.push({ account, name, amount, returnRate });
  });

  return rows;
}

function upsertAsset_(ss, asset) {
  const sheet = ensureSheet_(ss, SHEETS.assets);
  const values = sheet.getDataRange().getValues();
  const rowIndex = findRowByColumns_(values, {
    2: asset.type,
    3: asset.name,
    4: asset.institution,
  });

  const row = [
    asset.date,
    asset.type,
    asset.name,
    asset.institution,
    asset.amount,
    asset.profit,
    asset.memo,
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex + 1, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function upsertInvestment_(ss, investment) {
  const sheet = ensureSheet_(ss, SHEETS.investments);
  ensureInvestmentHeaders_(sheet);
  const values = sheet.getDataRange().getValues();
  const rowIndex = findRowByColumns_(values, {
    2: investment.account,
    5: investment.name,
  });

  const targetRow = rowIndex > 0 ? rowIndex + 1 : findFirstEmptyInvestmentRow_(sheet);
  const existing = rowIndex > 0 ? values[rowIndex] : [];
  const row = [
    firstNonEmpty_(investment.date, existing[0]),
    firstNonEmpty_(investment.account, existing[1], '일반'),
    firstNonEmpty_(investment.market, existing[2]),
    firstNonEmpty_(investment.symbol, existing[3]),
    firstNonEmpty_(investment.name, existing[4]),
    firstNonEmpty_(investment.quantity, existing[5]),
    firstNonEmpty_(investment.averagePrice, existing[6]),
    firstNonEmpty_(investment.manualValue, existing[7]),
    firstNonEmpty_(investment.manualReturn, existing[8]),
  ];

  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  sheet.getRange(targetRow, 14).setValue(firstNonEmpty_(investment.memo, existing[13]));
  fillInvestmentFormulas_(sheet, targetRow, targetRow);
}

function firstNonEmpty_(...values) {
  for (const value of values) {
    if (value !== '' && value !== null && typeof value !== 'undefined') return value;
  }

  return '';
}

function findFirstEmptyInvestmentRow_(sheet) {
  const startRow = 2;
  const rowsToScan = Math.max(sheet.getMaxRows() - 1, 1);
  const values = sheet.getRange(startRow, 1, rowsToScan, 14).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const hasUserData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 13].some(index => {
      return row[index] !== '' && row[index] !== null;
    });
    if (!hasUserData) return startRow + i;
  }

  sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  return sheet.getMaxRows();
}

function updateInvestmentAssetSummary_(ss, date) {
  upsertAssetFormula_(ss, {
    date,
    type: '주식',
    name: '투자 평가액',
    institution: '증권계좌',
    amountFormula: `=SUM('${SHEETS.investments}'!K:K)`,
    profit: '',
    memo: 'v2_투자 평가금액 합계 수식 반영',
  });
}

function upsertAssetFormula_(ss, asset) {
  const sheet = ensureSheet_(ss, SHEETS.assets);
  const values = sheet.getDataRange().getValues();
  const rowIndex = findRowByColumns_(values, {
    2: asset.type,
    3: asset.name,
    4: asset.institution,
  });

  const rowNumber = rowIndex > 0 ? rowIndex + 1 : sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, 4).setValues([[
    asset.date,
    asset.type,
    asset.name,
    asset.institution,
  ]]);
  sheet.getRange(rowNumber, 5).setFormula(asset.amountFormula);
  sheet.getRange(rowNumber, 6, 1, 2).setValues([[asset.profit, asset.memo]]);
}

function findRowByColumns_(values, criteria) {
  for (let i = 1; i < values.length; i++) {
    const matched = Object.keys(criteria).every(col => {
      return String(values[i][Number(col) - 1] || '') === String(criteria[col] || '');
    });
    if (matched) return i;
  }

  return -1;
}

function findHeaderRow_(values, requiredHeader) {
  return values.findIndex(row => row.includes('날짜') && row.includes(requiredHeader));
}

function makeIndex_(header) {
  const index = {};
  header.forEach((name, i) => {
    if (name) index[String(name)] = i;
  });
  return index;
}

function normalizeDate_(value, sheetName) {
  if (value instanceof Date) return formatDate_(value);

  const raw = String(value || '').trim();
  const sheetYear = sheetName.includes('2026') ? 2026 : 2025;

  let match = raw.match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (match) return dateParts_(match[1], match[2], match[3]);

  match = raw.match(/(20\d{2})[.\/-](\d{1,2})$/);
  if (match) return dateParts_(match[1], match[2], 1);

  match = raw.match(/^(\d{1,2})[.\/-](\d{1,2})$/);
  if (match) return dateParts_(sheetYear, match[1], match[2]);

  match = raw.match(/^(\d{1,2})(?:\.(\d+))?$/);
  if (match) {
    const month = match[1];
    const decimal = match[2] || '1';
    const day = decimal.length === 1 ? Number(decimal) * 10 : Number(decimal);
    return dateParts_(sheetYear, month, day);
  }

  const monthFromSheet = String(sheetName).match(/(\d{1,2})월/);
  if (monthFromSheet) return dateParts_(sheetYear, monthFromSheet[1], 1);

  return formatDate_(new Date());
}

function normalizeFastInputDate_(value) {
  if (value instanceof Date) return formatDate_(value);

  const raw = String(value || '').trim();
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;

  return normalizeDate_(raw, `${new Date().getFullYear()}년`);
}

function dateParts_(year, month, day) {
  return `${year}-${pad2_(month)}-${pad2_(day)}`;
}

function pad2_(value) {
  return String(value).padStart(2, '0');
}

// '월' 값이 텍스트('2025-10')든 날짜 객체('2025. 10. 1')든
// 항상 'yyyy-MM' 형태로 통일해 준다. 이번 버그의 핵심 해결 함수.
function normalizeMonth_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TZ, 'yyyy-MM');
  }
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[-.\/]\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}-${pad2_(match[2])}`;
  }
  return text.slice(0, 7);
}

function classify_(ss, memo) {
  const sheet = ss.getSheetByName(SHEETS.rules);
  if (!sheet) return {};

  const rows = sheet.getDataRange().getValues().slice(1);
  const text = String(memo || '').toLowerCase();

  for (const row of rows) {
    const keywords = String(row[0] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (keywords.some(k => text.includes(k.toLowerCase()))) {
      return {
        mainCategory: row[1],
        subCategory: row[2],
        fixedType: row[3],
        tags: row[4],
      };
    }
  }

  return {};
}

function setupRules_(ss) {
  const sheet = setupSheet_(ss, SHEETS.rules, [
    '키워드', '대분류', '소분류', '고정/변동', '태그', '우선순위'
  ]);

  const rows = [
    ['점심,식당,김밥,피자,라멘,버거,떡볶이,국수,백반', '식비', '외식', '변동', '#외식', 10],
    ['커피,카페,스타벅스,컴포즈,메가커피,아메리카노', '식비', '카페/간식', '변동', '#커피', 20],
    ['코스트코,마트,마켓컬리,와마트,반찬,장보기', '식비', '식자재', '변동', '#장보기', 30],
    ['쿠팡이츠,배민,요기요,배달', '식비', '배달', '변동', '#배달', 40],
    ['월세', '주거/통신', '주거비', '고정', '#고정비', 50],
    ['관리비', '주거/통신', '관리비', '고정', '#고정비', 60],
    ['SKT,브로드밴드,인터넷,통신비', '주거/통신', '통신비', '고정', '#통신', 70],
    ['국민연금,건강보험', '주거/통신', '세금/공과금', '고정', '#세금', 80],
    ['자동차,할부,주차', '교통/차량', '차량', '고정', '#차량', 90],
    ['수영,운동,헬스', '건강', '운동', '변동', '#운동', 100],
    ['넷플릭스,Apple,네이버플러스,Claude,API,구독', '문화/구독', '구독', '고정', '#구독', 110],
    ['다이소,생활잡화,생필품', '생활', '생활잡화', '변동', '#생활', 120],
    ['병원,보험,약', '건강', '의료/보험', '변동', '#건강', 130],
    ['게임,스팀,유니티,AssetStore,플레이엑스포', '취미', '게임', '변동', '#게임', 140],
    ['도서,교재,방통대,강의', '자기계발', '교육', '변동', '#교육', 150],
    ['선물,경조사,꽃', '생활', '경조사/선물', '변동', '#선물', 160],
    ['급여,월급,입금', '수입', '급여', '고정', '#수입', 170],
  ];

  replaceBody_(sheet, rows);
}

function setupAssets_(ss) {
  const sheet = setupSheet_(ss, SHEETS.assets, [
    '기준일', '자산구분', '이름', '기관', '금액', '평가손익', '메모'
  ]);

  replaceBody_(sheet, [
    ['', '현금', '생활비 계좌', '', '', '', '직접 입력'],
    ['', '예금', '비상금', '', '', '', '직접 입력'],
    ['', '주식', '국내/해외주식', '', '', '', '투자 탭과 연결 가능'],
    ['', '연금', '국민연금/퇴직연금', '', '', '', '직접 입력'],
  ]);
}

function setupLoans_(ss) {
  const sheet = setupSheet_(ss, SHEETS.loans, [
    '대출ID', '이름', '기관', '종류', '최초원금', '현재잔액', '금리',
    '월상환액', '상환일', '시작일', '종료예상', '상태', '메모'
  ]);

  replaceBody_(sheet, [
    ['LOAN-001', '자동차 할부', '국민카드', '할부', '', '', '', 515690, '매월 14일', '', '', '상환중', '기존 고정비 탭 기준'],
    ['LOAN-002', '햇살론', '토스뱅크', '원리금', '', 6100000, '', 225779, '매월 1일', '', '', '상환중', '고정비 탭 메모 잔액 기준'],
  ]);
}

function setupInvestments_(ss) {
  const sheet = setupSheet_(ss, SHEETS.investments, [
    '기준일', '계좌', '시장', '종목코드', '종목명', '수량', '평균단가',
    '수동평가금액', '수동수익률', '현재가', '평가금액', '평가손익', '수익률', '메모'
  ]);

  fillInvestmentFormulas_(sheet, 2, 200);
}

function ensureInvestmentHeaders_(sheet) {
  const headers = [
    '기준일', '계좌', '시장', '종목코드', '종목명', '수량', '평균단가',
    '수동평가금액', '수동수익률', '현재가', '평가금액', '평가손익', '수익률', '메모'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1f405c');
}

function fillInvestmentFormulas_(sheet, startRow, endRow) {
  for (let row = startRow; row <= endRow; row++) {
    sheet.getRange(row, 10).setFormula(`=IF(D${row}="","",IFERROR(GOOGLEFINANCE(IF(C${row}="",D${row},C${row}&":"&D${row}),"price"),""))`);
    sheet.getRange(row, 11).setFormula(`=IF(AND(F${row}<>"",J${row}<>""),F${row}*J${row},H${row})`);
    sheet.getRange(row, 12).setFormula(`=IF(AND(F${row}<>"",G${row}<>"",K${row}<>""),K${row}-F${row}*G${row},"")`);
    sheet.getRange(row, 13).setFormula(`=IF(AND(F${row}<>"",G${row}<>"",J${row}<>""),J${row}/G${row}-1,I${row})`);
  }
}

function setupReport_(ss) {
  const sheet = setupSheet_(ss, SHEETS.report, [
    '월', '총지출', '분담금', '실지출', '고정비', '변동비', '식비',
    '주거/통신', '교통/차량', '생활', '건강', '문화/구독', '취미',
    '자기계발', '순자산', '메모'
  ]);

  const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
  sheet.getRange(2, 1, months.length, 1).setNumberFormat('@');
  sheet.getRange(2, 1, months.length, 1).setValues(months.map(m => [m]));

  for (let row = 2; row < 2 + months.length; row++) {
    const monthKey = `$A${row}`;
    sheet.getRange(row, 2).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!E:E,"지출"))`);
    sheet.getRange(row, 3).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!M:M,'${SHEETS.ledger}'!D:D,${monthKey}))`);
    sheet.getRange(row, 4).setFormula(`=IF($A${row}="","",B${row}-C${row})`);
    sheet.getRange(row, 5).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!F:F,"고정"))`);
    sheet.getRange(row, 6).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!F:F,"변동"))`);
    sheet.getRange(row, 7).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"식비"))`);
    sheet.getRange(row, 8).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"주거/통신"))`);
    sheet.getRange(row, 9).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"교통/차량")+SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"교통"))`);
    sheet.getRange(row, 10).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"생활"))`);
    sheet.getRange(row, 11).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"건강"))`);
    sheet.getRange(row, 12).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"문화/구독"))`);
    sheet.getRange(row, 13).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"취미"))`);
    sheet.getRange(row, 14).setFormula(`=IF($A${row}="","",SUMIFS('${SHEETS.ledger}'!J:J,'${SHEETS.ledger}'!D:D,${monthKey},'${SHEETS.ledger}'!G:G,"자기계발"))`);
    sheet.getRange(row, 15).setFormula(`=IF($A${row}="","",SUM('${SHEETS.assets}'!E:E)-SUM('${SHEETS.loans}'!F:F))`);
  }
}

function resizeSheetColumnsForHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const overrides = {
    '거래ID': 270,
    '입력시각': 110,
    '날짜': 105,
    '월': 90,
    '구분': 75,
    '고정/변동': 105,
    '대분류': 105,
    '소분류': 120,
    '내역': 190,
    '금액': 90,
    '결제수단': 120,
    '태그': 180,
    '분담금': 95,
    '실지출': 95,
    '입력원': 85,
    '원본탭': 95,
    '원본행': 85,
    '메모': 180,
    '파싱상태': 100,
    '자산구분': 105,
    '평가손익': 105,
    '월상환액': 105,
    '종목코드': 105,
    '시장': 80,
    '수동평가금액': 125,
    '수동수익률': 105,
    '평가금액': 105,
    '현재가': 95,
    '수량': 85,
    '평균단가': 105,
    '수익률': 85,
    '우선순위': 95,
  };

  headers.forEach((header, index) => {
    const name = String(header || '');
    if (!name) return;

    const width = overrides[name] || Math.min(Math.max(displayWidth_(name) * 9 + 34, 70), 220);
    sheet.setColumnWidth(index + 1, width);
  });
}

function displayWidth_(value) {
  return String(value).split('').reduce((sum, char) => {
    return sum + (char.charCodeAt(0) > 127 ? 2 : 1);
  }, 0);
}

function readObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(value => String(value || '').trim());
  return values.slice(1)
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        if (header) obj[header] = row[index];
      });
      return obj;
    });
}

function clearSheetBody_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
}

function number_(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').replace(/[,\s원%]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function sumBy_(rows, key) {
  return rows.reduce((sum, row) => sum + number_(row[key]), 0);
}

function groupSum_(rows, groupKey, valueKey) {
  const totals = {};
  rows.forEach(row => {
    const key = row[groupKey] || '미분류';
    totals[key] = (totals[key] || 0) + number_(row[valueKey]);
  });

  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function getMonthMetrics_(ledgerRows, month) {
  const rows = ledgerRows.filter(row => normalizeMonth_(row['월']) === month && row['구분'] === '지출');
  const totalSpend = sumBy_(rows, '금액');
  const split = sumBy_(rows, '분담금');
  const fixed = sumBy_(rows.filter(row => row['고정/변동'] === '고정'), '금액');
  const variable = sumBy_(rows.filter(row => row['고정/변동'] === '변동'), '금액');

  return {
    month,
    rows,
    count: rows.length,
    totalSpend,
    split,
    realSpend: totalSpend - split,
    fixed,
    variable,
  };
}

function resetInsightSheet_(sheet) {
  sheet.clear();
  try {
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  } catch (err) {
    // Some sheets may not have merged cells; keep going.
  }
  sheet.setHiddenGridlines(true);
}

function drawDashboardTitle_(sheet, month) {
  sheet.getRange(1, 1, 1, 12).merge().setValue(`가계부 인사이트 | ${month}`);
  sheet.getRange(1, 1)
    .setFontSize(18)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#16324f')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 42);

  sheet.getRange(2, 1, 1, 12).merge().setValue(`생성시각: ${Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm')} / 원본: v2_거래원장, v2_자산, v2_대출, v2_투자`);
  sheet.getRange(2, 1).setFontColor('#44546a').setBackground('#eaf2f8');
}

function drawKpiCard_(sheet, row, col, title, value, note, color, format) {
  sheet.getRange(row, col)
    .setValue(title)
    .setBackground(color)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange(row + 1, col)
    .setValue(formatKpiValue_(value, format))
    .setFontSize(18)
    .setFontWeight('bold')
    .setBackground(color)
    .setHorizontalAlignment('center');

  sheet.getRange(row + 2, col)
    .setValue(note)
    .setFontSize(9)
    .setBackground(color)
    .setWrap(true)
    .setHorizontalAlignment('center');

  sheet.getRange(row, col, 3, 1)
    .setBorder(true, true, true, true, false, false);
}

function formatKpiValue_(value, format) {
  if (format === '0.0%') return formatPercent_(number_(value));
  if (format === '0') return String(Math.round(number_(value)));
  return formatMoney_(number_(value));
}

function drawSection_(sheet, row, col, width, title) {
  sheet.getRange(row, col, 1, width).merge().setValue(title);
  sheet.getRange(row, col)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1f405c')
    .setHorizontalAlignment('center');
}

function writeTableBlock_(sheet, row, col, title, headers, rows, options) {
  const width = headers.length;
  const safeRows = rows.length ? rows : [headers.map((_, index) => index === 0 ? '데이터 없음' : '')];
  drawSection_(sheet, row, col, width, title);
  sheet.getRange(row + 1, col, 1, width).setValues([headers]);
  sheet.getRange(row + 1, col, 1, width).setFontWeight('bold').setBackground('#d9ead3');
  sheet.getRange(row + 2, col, safeRows.length, width).setValues(safeRows);
  sheet.getRange(row + 2, col, safeRows.length, width).setBorder(false, false, true, false, true, false, '#d9d9d9', SpreadsheetApp.BorderStyle.SOLID);

  const opts = options || {};
  (opts.moneyColumns || []).forEach(column => {
    sheet.getRange(row + 2, col + column - 1, safeRows.length, 1).setNumberFormat('#,##0');
  });
  (opts.percentColumns || []).forEach(column => {
    sheet.getRange(row + 2, col + column - 1, safeRows.length, 1).setNumberFormat('0.0%');
  });
  (opts.numberColumns || []).forEach(column => {
    sheet.getRange(row + 2, col + column - 1, safeRows.length, 1).setNumberFormat('0');
  });
}

function groupValue_(totals, name) {
  const found = totals.find(([item]) => item === name);
  return found ? found[1] : 0;
}

function buildGroupDeltas_(currentTotals, previousTotals) {
  return currentTotals
    .map(([name, current]) => {
      const previous = groupValue_(previousTotals, name);
      return { name, current, previous, delta: current - previous };
    })
    .sort((a, b) => b.delta - a.delta);
}

function buildDataQualityRows_(ledgerRows, currentRows, investmentRows, assetRows, loanRows) {
  const rows = [];
  const badPayment = currentRows.filter(row => !row['결제수단'] || row['결제수단'] === '결제수단').length;
  const uncategorized = currentRows.filter(row => !row['대분류'] || row['대분류'] === '미분류').length;
  const missingAmount = ledgerRows.filter(row => !number_(row['금액'])).length;
  const manualInvestments = investmentRows.filter(row => number_(row['수동평가금액']) && !row['종목코드']).length;
  const missingLoanBalance = loanRows.filter(row => row['상태'] === '상환중' && !number_(row['현재잔액'])).length;
  const emptyAssets = assetRows.filter(row => !number_(row['금액']) && row['자산구분']).length;

  rows.push({ level: badPayment ? '확인필요' : '좋음', item: '결제수단 임시값/공백', count: badPayment, action: badPayment ? '거래원장에서 결제수단 정리' : '정리됨' });
  rows.push({ level: uncategorized ? '확인필요' : '좋음', item: '미분류 지출', count: uncategorized, action: uncategorized ? '분류규칙 또는 거래원장 수정' : '정리됨' });
  rows.push({ level: missingAmount ? '확인필요' : '좋음', item: '금액 누락 거래', count: missingAmount, action: missingAmount ? '원본 월별 탭/거래원장 확인' : '정리됨' });
  rows.push({ level: manualInvestments ? '주의' : '좋음', item: '수동 평가 투자', count: manualInvestments, action: manualInvestments ? '종목코드/시장/수량/평단 입력 시 자동화' : '자동화됨' });
  rows.push({ level: missingLoanBalance ? '확인필요' : '좋음', item: '상환중 대출 잔액 누락', count: missingLoanBalance, action: missingLoanBalance ? '대출 탭 현재잔액 입력' : '정리됨' });
  rows.push({ level: emptyAssets ? '주의' : '좋음', item: '금액 없는 자산 행', count: emptyAssets, action: emptyAssets ? '자산 탭 금액 입력 또는 행 정리' : '정리됨' });

  return rows;
}

function buildDashboardInsightLines_(data) {
  const lines = [];
  const topCategory = data.categoryTotals[0];
  const topDelta = data.categoryDeltas.find(row => row.delta > 0);
  const fixedShare = data.totalSpend ? data.fixed / data.totalSpend : 0;

  if (data.prevMonth) {
    const diff = data.realSpend - data.prevRealSpend;
    lines.push(`실지출은 ${data.prevMonth} 대비 ${formatSignedMoney_(diff)}입니다. ${diff > 0 ? '증가 원인을 아래 카테고리 증감에서 확인하세요.' : '지출 흐름은 전월보다 안정적입니다.'}`);
  }

  if (topCategory) {
    lines.push(`이번 달 최다 지출은 ${topCategory[0]} ${formatMoney_(topCategory[1])}이며 총지출의 ${formatPercent_(data.totalSpend ? topCategory[1] / data.totalSpend : 0)}입니다.`);
  }

  if (topDelta) {
    lines.push(`전월 대비 가장 많이 늘어난 카테고리는 ${topDelta.name}이며 ${formatMoney_(topDelta.delta)} 증가했습니다.`);
  }

  lines.push(`고정비 비중은 ${formatPercent_(fixedShare)}입니다. ${fixedShare > 0.6 ? '고정비가 높은 편이라 대출/구독/주거비를 우선 점검하세요.' : '고정비 부담은 과도하지 않은 편입니다.'}`);

  if (data.split) {
    lines.push(`정산/분담금 ${formatMoney_(data.split)}을 제외하면 실제 체감 지출은 ${formatMoney_(data.realSpend)}입니다.`);
  }

  if (data.investmentTotal) {
    lines.push(`투자 평가액은 ${formatMoney_(data.investmentTotal)}이고, 최대 보유 종목 비중은 ${formatPercent_(data.topInvestmentShare)}입니다.`);
  }

  if (data.debtTotal) {
    lines.push(`입력된 부채 잔액은 ${formatMoney_(data.debtTotal)}이며 순자산은 ${formatMoney_(data.netWorth)}입니다.`);
  }

  const qualityIssues = data.dataQuality.filter(row => row.count > 0).length;
  if (qualityIssues) {
    lines.push(`데이터 품질 이슈가 ${qualityIssues}종류 있습니다. 오른쪽 품질 표의 확인필요 항목부터 정리하면 리포트 정확도가 올라갑니다.`);
  }

  return lines;
}

function buildActionLines_(qualityRows, categoryDeltas, losingInvestments, topInvestmentShare, current) {
  const lines = [];
  const quality = qualityRows.find(row => row.count > 0);
  const topDelta = categoryDeltas.find(row => row.delta > 0);

  if (quality) lines.push(`[데이터] ${quality.item} ${quality.count}건: ${quality.action}`);
  if (topDelta && topDelta.delta > 50000) lines.push(`[지출] ${topDelta.name} 증가분 ${formatMoney_(topDelta.delta)} 확인`);
  if (current.totalSpend && current.variable / current.totalSpend > 0.45) lines.push(`[생활비] 변동비 비중 ${formatPercent_(current.variable / current.totalSpend)}: 식비/생활/취미 점검`);
  if (topInvestmentShare > 0.4) lines.push(`[투자] 단일 종목 비중 ${formatPercent_(topInvestmentShare)}: 집중도 확인`);
  if (losingInvestments.length) lines.push(`[투자] 손실률 큰 종목 ${losingInvestments[0]['종목명']} 우선 점검`);

  return lines.length ? lines : ['이번 달은 큰 경고 없이 정리된 상태입니다.'];
}

function formatMoney_(value) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatSignedMoney_(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatMoney_(Math.abs(value))}`;
}

function formatPercent_(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function parseRate_(value) {
  if (typeof value === 'number') return Math.abs(value) > 1 ? value / 100 : value;
  const text = String(value || '').trim();
  const match = text.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return 0;
  return Number(match[0]) / 100;
}

// 투자 행에서 수익률을 꺼낸다. (수익률 → 수동수익률 → 평가손익 순으로 우선)
function investmentRate_(row) {
  return parseRate_(row['수익률'] || row['수동수익률'] || row['평가손익']);
}

function setupSheet_(ss, name, headers) {
  const sheet = ensureSheet_(ss, name);
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1f405c');

  try {
    sheet.getFilter() && sheet.getFilter().remove();
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), headers.length).createFilter();
  } catch (err) {
    // Filters can fail on very small/empty sheets; formatting is still useful.
  }

  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function ensureSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// 거래원장 헤더. setupV2와 ledgerSheet_가 공유한다(반드시 일치).
const LEDGER_HEADERS = [
  '거래ID', '입력시각', '날짜', '월', '구분', '고정/변동', '대분류', '소분류',
  '내역', '금액', '결제수단', '태그', '분담금', '실지출', '입력원', '원본탭',
  '원본행', '메모'
];

// 빠른입력 헤더. setupV2와 fastSheet_가 공유한다(반드시 일치).
const FAST_HEADERS = [
  '입력시각', '원문', '파싱상태', '날짜', '구분', '금액', '내역', '결제수단',
  '고정/변동', '대분류', '소분류', '태그', '분담금', '메모'
];

// 빠른입력 시트를 얻는다. 비어 있으면 헤더를 먼저 넣는다(프로필 탭 헤더 누락 방지).
function fastSheet_(ss) {
  var sheet = ensureSheet_(ss, SHEETS.fast);
  if (sheet.getLastRow() === 0) sheet.appendRow(FAST_HEADERS);
  return sheet;
}

// 거래원장 시트를 얻는다. 없거나 비어 있으면 헤더 행을 먼저 넣는다.
// (프로필별 es_ 탭이 setupV2 없이 헤더 없는 상태로 생성되어 append/read가 어긋나는 문제 방지)
function ledgerSheet_(ss) {
  var sheet = ensureSheet_(ss, SHEETS.ledger);
  if (sheet.getLastRow() === 0) sheet.appendRow(LEDGER_HEADERS);
  return sheet;
}

function replaceBody_(sheet, rows) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function formatDate_(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  return !!expected && String(token) === expected;
}

// 스토어 스냅샷 시트명. 프로필별로 분리한다(안 하면 브리 es와 사용자 v2가 같은 셀을 덮어씀).
// 기존 사용자는 'AppState'(무접두어) 그대로 두어 마이그레이션 불필요, es만 'es_AppState'.
function appStateSheetName_() {
  return (SHEET_PREFIX === 'v2_') ? APP_STATE_SHEET : SHEET_PREFIX + 'AppState';
}

function readAppState_(ss) {
  const sheet = ss.getSheetByName(appStateSheetName_());
  if (!sheet || sheet.getLastRow() < 1) return { store: '', updatedAt: '' };
  const store = sheet.getRange('A1').getValue();
  const updatedAt = sheet.getRange('B1').getValue();
  return { store: String(store || ''), updatedAt: String(updatedAt || '') };
}

function writeAppState_(ss, storeJson, updatedAt) {
  const sheet = ensureSheet_(ss, appStateSheetName_());
  sheet.getRange('A1').setValue(storeJson);
  sheet.getRange('B1').setValue(updatedAt);
  SpreadsheetApp.flush();
}

function setSyncToken() {
  const value = 'PUT-A-LONG-RANDOM-TOKEN-HERE';
  if (value.indexOf('PUT-') === 0) throw new Error('실행 전에 setSyncToken의 토큰 값을 실제 랜덤 문자열로 바꾸세요.');
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', value);
}

function readLedgerTransactions_(ss) {
  const sheet = ss.getSheetByName(SHEETS.ledger);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const idx = makeIndex_(values[0]);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const amount = Number(row[idx['금액']]) || 0;
    const memo = String(row[idx['내역']] || '');
    if (!amount && !memo) continue;
    const rawDate = row[idx['날짜']];
    const date = rawDate instanceof Date ? formatDate_(rawDate) : String(rawDate || '');
    out.push({
      id: String(row[idx['거래ID']] || ('led-' + r)),
      date: date,
      type: String(row[idx['구분']] || '') === '수입' ? 'income' : 'expense',
      amount: amount,
      memo: memo,
      category: String(row[idx['대분류']] || ''),
      subCategory: String(row[idx['소분류']] || ''),
      payment: String(row[idx['결제수단']] || ''),
      fixedType: String(row[idx['고정/변동']] || '') === '고정' ? 'fixed' : 'variable',
      split: Number(row[idx['분담금']]) || 0,
      raw: ''
    });
  }
  return out;
}

function upsertRule_(ss, keyword, category, subCategory) {
  var sheet = ss.getSheetByName(SHEETS.rules);
  if (!sheet || !keyword) return;
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === String(keyword).trim()) {
      sheet.getRange(r + 1, 2).setValue(category);
      sheet.getRange(r + 1, 3).setValue(subCategory);
      return;
    }
  }
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 6).setValues([[keyword, category, subCategory, '변동', '', 5]]);
}

function assignCategory_(ss, id, category, subCategory, passedMemo) {
  var sheet = ss.getSheetByName(SHEETS.ledger);
  if (!sheet) return { ok: false, error: 'no ledger' };
  var values = sheet.getDataRange().getValues();
  var idx = makeIndex_(values[0]);
  var cId = idx['거래ID'], cCat = idx['대분류'], cSub = idx['소분류'], cMemo = idx['내역'];
  var memo = String(passedMemo || '').trim(), found = false, updated = 0;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][cId]) === String(id)) {
      memo = String(values[r][cMemo] || '').trim() || memo;
      sheet.getRange(r + 1, cCat + 1).setValue(category);
      sheet.getRange(r + 1, cSub + 1).setValue(subCategory);
      found = true; updated++;
      break;
    }
  }
  // 원장에 없어도(로컬 거래) memo가 있으면 규칙 학습 + 같은 내역 미분류 일괄 처리
  if (!memo) return { ok: false, error: 'not found' };
  for (var r2 = 1; r2 < values.length; r2++) {
    if (String(values[r2][cCat]) === '미분류' &&
        String(values[r2][cMemo] || '').trim() === memo &&
        String(values[r2][cId]) !== String(id)) {
      sheet.getRange(r2 + 1, cCat + 1).setValue(category);
      sheet.getRange(r2 + 1, cSub + 1).setValue(subCategory);
      updated++;
    }
  }
  upsertRule_(ss, memo, category, subCategory);
  SpreadsheetApp.flush();
  return { ok: true, updated: updated, found: found };
}

var FIXED_HEADERS = ['id', '활성', '이름', '금액', '대분류', '소분류', '결제수단', '납부일', '시작월', '할부총회차', '변동', '분담금', '구분'];

function fixedSheet_(ss) {
  var sheet = ss.getSheetByName(SHEETS.fixedDefs);
  if (!sheet) { sheet = ss.insertSheet(SHEETS.fixedDefs); sheet.appendRow(FIXED_HEADERS); return sheet; }
  if (sheet.getLastColumn() < FIXED_HEADERS.length) {
    sheet.getRange(1, 1, 1, FIXED_HEADERS.length).setValues([FIXED_HEADERS]);
  }
  return sheet;
}

function toYearMonth_(v) {
  if (v instanceof Date) {
    return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2);
  }
  return String(v || '').slice(0, 7);
}

function readFixedDefs_(ss) {
  var sheet = fixedSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var defs = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[0] && !row[2]) continue;
    defs.push({
      id: String(row[0]), active: row[1] === true || String(row[1]).toUpperCase() === 'TRUE',
      name: String(row[2]), amount: Number(row[3]) || 0,
      category: String(row[4]), subCategory: String(row[5]), payment: String(row[6]),
      payDay: Number(row[7]) || 1, startMonth: toYearMonth_(row[8]),
      installmentTotal: row[9] === '' || row[9] === null ? null : Number(row[9]),
      variable: row[10] === true || String(row[10]).toUpperCase() === 'TRUE',
      split: Number(row[11]) || 0,
      kind: String(row[12]) === '수입' ? 'income' : 'expense',
    });
  }
  return defs;
}

function saveFixedDef_(ss, def) {
  var sheet = fixedSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var rowArr = [
    def.id || Utilities.getUuid(), def.active !== false, String(def.name || ''), Number(def.amount) || 0,
    String(def.category || ''), String(def.subCategory || ''), String(def.payment || ''),
    Number(def.payDay) || 1, String(def.startMonth || ''),
    (def.installmentTotal === null || def.installmentTotal === undefined || def.installmentTotal === '') ? '' : Number(def.installmentTotal),
    def.variable === true,
    Number(def.split) || 0,
    def.kind === 'income' ? '수입' : '지출',
  ];
  if (def.id) {
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][0]) === String(def.id)) {
        sheet.getRange(r + 1, 1, 1, FIXED_HEADERS.length).setValues([rowArr]);
        return { ok: true, id: def.id };
      }
    }
  }
  sheet.appendRow(rowArr);
  return { ok: true, id: rowArr[0] };
}

function deleteFixedDef_(ss, id) {
  var sheet = fixedSheet_(ss);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(id)) { sheet.deleteRow(r + 1); return { ok: true }; }
  }
  return { ok: false, error: 'not found' };
}

function monthIndex_(ym) {
  var p = String(ym).split('-');
  return Number(p[0]) * 12 + (Number(p[1]) - 1);
}

function autoPostFixed_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var defs = readFixedDefs_(ss);
  var today = new Date();
  var y = today.getFullYear(), m = today.getMonth() + 1, day = today.getDate();
  var thisMonth = y + '-' + ('0' + m).slice(-2);
  var thisIdx = y * 12 + (m - 1);
  var ledger = ledgerSheet_(ss);
  var lvals = ledger.getDataRange().getValues();
  var li = makeIndex_(lvals[0]);
  var existing = {};
  var existingByCatAmt = {};   // 대분류|금액|월 → 중복 자동입력 방지(수동/시리로 같은 항목 넣은 경우)
  for (var r = 1; r < lvals.length; r++) {
    var d = lvals[r][li['날짜']];
    var ds = (d instanceof Date) ? formatDate_(d) : String(d);
    var mon = ds.slice(0, 7);
    existing[String(lvals[r][li['내역']]).trim() + '|' + mon] = true;
    existingByCatAmt[String(lvals[r][li['대분류']]).trim() + '|' + (Number(lvals[r][li['금액']]) || 0) + '|' + mon] = true;
  }
  var posted = 0;
  var skipped = [];   // 왜 안 들어갔는지 알아야 트리거가 조용히 죽은 건지 구분이 된다
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    if (!def.active || !def.amount) { skipped.push(def.name + ': 비활성/금액0'); continue; }
    var lastDay = new Date(y, m, 0).getDate();
    var effDay = Math.min(def.payDay, lastDay);
    if (day < effDay) { skipped.push(def.name + ': 출금일(' + effDay + ') 전'); continue; }
    var startIdx = monthIndex_(def.startMonth);
    if (thisIdx < startIdx) { skipped.push(def.name + ': 시작월(' + def.startMonth + ') 전'); continue; }
    if (def.installmentTotal && thisIdx >= startIdx + def.installmentTotal) { skipped.push(def.name + ': 할부 종료'); continue; }

    // 할부는 원장에서 정기 고정비와 구분돼야 한다. 이름에 회차를, 메모에 다른 태그를 남긴다.
    var isInst = !!def.installmentTotal;
    var round = thisIdx - startIdx + 1;
    var postName = isInst ? (def.name + ' (' + round + '/' + def.installmentTotal + ')') : def.name;

    // 회차 표기 전/후 이름을 모두 확인해야 수동으로 먼저 넣은 건과 겹치지 않는다
    if (existing[postName.trim() + '|' + thisMonth] || existing[def.name.trim() + '|' + thisMonth]) {
      skipped.push(def.name + ': 이미 등록됨'); continue;
    }
    // 같은 분류+금액이 이미 이번 달에 있으면(수동/시리 중복입력) 자동입력 생략
    if (existingByCatAmt[String(def.category).trim() + '|' + (Number(def.amount) || 0) + '|' + thisMonth]) {
      skipped.push(def.name + ': 같은 분류·금액이 이미 있음'); continue;
    }
    var date = thisMonth + '-' + ('0' + effDay).slice(-2);
    var isIncome = def.kind === 'income';
    var split = isIncome ? 0 : (Number(def.split) || 0);
    ledger.appendRow([
      Utilities.getUuid(), new Date(), date, thisMonth, isIncome ? '수입' : '지출', '고정',
      def.category, def.subCategory, postName, def.amount,
      def.payment, def.variable ? '#확인필요' : '', split || '', isIncome ? def.amount : (def.amount - split), 'auto', '', '',
      isInst ? '할부자동' : '고정비자동',
    ]);
    posted++;
  }
  SpreadsheetApp.flush();
  return { ok: true, posted: posted, month: thisMonth, day: day, defs: defs.length, skipped: skipped };
}

function autoPostFixedDaily() {
  // 시간 트리거는 요청이 아니라 applyProfile_이 안 걸린다 → 프로필마다 돌려야
  // 브리(es) 고정비도 자기 원장에 등록된다.
  var out = [];
  ['', 'es'].forEach(function (p) {
    applyProfile_(p);
    out.push({ profile: p || 'v2', result: autoPostFixed_() });
  });
  applyProfile_('');   // 기본(v2_)으로 원복
  return out;
}

// 이름에 언더스코어를 붙이면 Apps Script 편집기의 실행 목록에서 사라진다.
// 손으로 한 번씩 돌려야 하는 함수라 공개 이름으로 둔다.
function installFixedTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoPostFixedDaily') return { ok: true, existing: true };
  }
  ScriptApp.newTrigger('autoPostFixedDaily').timeBased().everyDays(1).atHour(4).create();
  return { ok: true, created: true };
}


// ── 건강 데이터 (별도 스프레드시트) ──────────────────────────
// 가계부 시트에 탭을 섞지 않는다: migrateExistingTransactions가 모르는 탭을 원장으로 빨아들임.
// 시트는 첫 호출 때 스크립트 계정에 만들고 ID를 스크립트 속성에 저장한다(다른 계정 시트는 권한 오류).
const HEALTH_HEADERS = ['start', 'end', 'value', 'extra', 'received'];   // extra: 4번째 이후 필드를 |로 합침(운동 세션 등)

function healthSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('HEALTH_SHEET_ID');
  if (!id) {
    id = SpreadsheetApp.create('건강 데이터 (health)').getId();
    props.setProperty('HEALTH_SHEET_ID', id);
  }
  return SpreadsheetApp.openById(id);
}

// "시작|종료|값[|추가...]" 줄들 → [[시작, 종료, 값, 추가], ...]. 빈 줄·구분자 없는 줄은 버린다.
function healthParse_(rowsText) {
  return String(rowsText || '').replace(/%0A/gi, '\n').split(/\r?\n/)
    .map(l => l.trim()).filter(l => l.includes('|'))
    .map(l => { const f = l.split('|').map(x => x.trim()); return [f[0], f[1], f[2] || '', f.slice(3).join('|')]; });
}

function healthSheet_(type) {
  const name = String(type || '').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'raw';
  const ss = healthSpreadsheet_();
  // 예전 정규식이 숫자를 지워 'vomax'·'spo'로 만들어진 탭을 한 번 이름 바꿔 준다
  const legacy = { vo2max: 'vomax', spo2: 'spo' }[name];
  if (legacy && !ss.getSheetByName(name) && ss.getSheetByName(legacy)) ss.getSheetByName(legacy).setName(name);
  const sheet = ensureSheet_(ss, name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange('A:D').setNumberFormat('@');   // 날짜·값 문자열을 Date/숫자로 바꾸지 않게(중복 키 안정)
    sheet.appendRow(HEALTH_HEADERS);
  }
  return sheet;
}

// 일 단위 탭: 하루 한 행. 같은 날짜(start 앞 10자)가 있으면 그 행을 덮어쓴다(단축어는 오늘 값을 매번 갱신해 보냄).
const HEALTH_DAILY_TABS = ['resting_hr', 'hrv', 'respiratory_rate', 'wrist_temp', 'spo2', 'breathing_disturb', 'steps', 'active_kcal', 'exercise_min', 'stand_hours'];

function healthUpsertDaily_(sheet, rows) {
  const values = sheet.getDataRange().getValues();
  const rowOf = new Map();   // day → 시트 행 번호(1-based)
  for (let i = 1; i < values.length; i++) rowOf.set(String(values[i][0]).slice(0, 10), i + 1);
  const now = new Date(); let added = 0, updated = 0;
  const fresh = [];
  rows.forEach(r => {
    const day = r[0].slice(0, 10); const rn = rowOf.get(day);
    if (rn) { sheet.getRange(rn, 1, 1, 5).setValues([[r[0], r[1], r[2], r[3], now]]); updated++; }
    else if (!fresh.some(f => f[0].slice(0, 10) === day)) { fresh.push(r); }
  });
  if (fresh.length) { sheet.getRange(sheet.getLastRow() + 1, 1, fresh.length, 5).setValues(fresh.map(r => [r[0], r[1], r[2], r[3], now])); added = fresh.length; }
  return { ok: true, sheet: sheet.getName(), added, updated, url: sheet.getParent().getUrl() };
}

// 같은 (시작|종료|값)은 건너뛴다 — 단축어가 두 번 돌아도 무해.
function healthAppend_(type, rowsText) {
  const sheet = healthSheet_(type);
  const rows = healthParse_(rowsText);
  if (HEALTH_DAILY_TABS.includes(sheet.getName())) return healthUpsertDaily_(sheet, rows);
  const seen = new Set(sheet.getDataRange().getValues().slice(1).map(r => r.slice(0, 3).join('|')));
  const now = new Date();
  const fresh = rows.filter(r => { const k = r.slice(0, 3).join('|'); if (seen.has(k)) return false; seen.add(k); return true; });   // 시트·같은 요청 안 중복 모두 제거
  if (fresh.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, fresh.length, 5)
      .setValues(fresh.map(r => [r[0], r[1], r[2], r[3], now]));
  }
  const out = { ok: true, sheet: sheet.getName(), added: fresh.length, skipped: rows.length - fresh.length, url: sheet.getParent().getUrl() };
  // 파싱된 행이 0이면 뭘 받았는지 앞부분을 돌려줘 단축어 알림에서 바로 진단하게 한다.
  if (!rows.length) { out.rawLen = String(rowsText || '').length; out.rawHead = String(rowsText || '').slice(0, 160); }
  return out;
}

// 최근 days일 행. start는 'yyyy-MM-dd ...' 문자열이라 날짜 접두 비교로 자른다.
function healthRows_(type, days) {
  return healthSheetRows_(healthSheet_(type), days);
}
function healthSheetRows_(sheet, days) {
  const since = Utilities.formatDate(new Date(Date.now() - days * 86400000), TZ, 'yyyy-MM-dd');
  if (sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(r => String(r[0]) >= since)
    .map(r => ({ start: String(r[0]), end: String(r[1]), value: String(r[2]), extra: String(r[3] || '') }));
}
// 탭 정리(중복 적재 복구용): 일 단위 탭은 날짜별 마지막 행만, 그 외는 (시작|종료|값) 기준 한 행만 남기고 날짜순으로 다시 쓴다.
function healthCompact_(type) {
  const sheet = healthSheet_(type);
  const values = sheet.getDataRange().getValues();
  const daily = HEALTH_DAILY_TABS.includes(sheet.getName());
  const last = new Map();
  values.slice(1).forEach(r => { if (String(r[0]).length >= 10) last.set(daily ? String(r[0]).slice(0, 10) : r.slice(0, 3).map(String).join('|'), r); });
  const rows = [...last.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(e => e[1]);
  sheet.getRange(2, 1, Math.max(values.length - 1, 1), 5).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  return { ok: true, sheet: sheet.getName(), before: values.length - 1, after: rows.length };
}

function healthAll_(days) {
  const out = {};
  healthSpreadsheet_().getSheets().forEach(sh => { out[sh.getName()] = healthSheetRows_(sh, days); });
  return out;
}


// ── 가계부 시트 정리 ─────────────────────────────────────────
const LEGACY_TABS = ['10월', '11월', '12월', '2026년 1월', '2026년 2월', '2026년 3월', '2026년 4월', '2026년 5월', '고정비'];
const TAB_ORDER = ['v2_거래원장', 'v2_빠른입력', 'v2_고정비', 'v2_분류규칙', 'v2_월간리포트', 'v2_인사이트', 'v2_자산', 'v2_투자', 'v2_대출', 'AppState', 'es_거래원장', 'es_고정비', 'es_AppState'];

function archiveSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('ARCHIVE_SHEET_ID');
  if (!id) { id = SpreadsheetApp.create('가계부 보관 (옛 수기 탭)').getId(); props.setProperty('ARCHIVE_SHEET_ID', id); }
  return SpreadsheetApp.openById(id);
}

function archiveLegacy_(step) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (step === 'reorder') {
    TAB_ORDER.forEach((name, i) => { const sh = ss.getSheetByName(name); if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); } });
    return { ok: true, order: ss.getSheets().map(s => s.getName()) };
  }
  const ar = archiveSpreadsheet_();
  const report = [];
  LEGACY_TABS.forEach(name => {
    const src = ss.getSheetByName(name); if (!src) return;
    let dst = ar.getSheetByName(name);
    if (step === 'copy') {
      if (!dst) { dst = src.copyTo(ar); dst.setName(name); }
      report.push({ name, srcRows: src.getLastRow(), dstRows: dst.getLastRow() });
    } else if (step === 'delete') {
      if (dst && dst.getLastRow() === src.getLastRow() && dst.getLastColumn() === src.getLastColumn()) { ss.deleteSheet(src); report.push({ name, deleted: true }); }
      else report.push({ name, deleted: false, reason: dst ? 'row/col mismatch' : 'no archive copy' });
    }
  });
  if (step === 'copy') { const first = ar.getSheetByName('시트1'); if (first && ar.getSheets().length > 1) ar.deleteSheet(first); }
  return { ok: true, step, archive: ar.getUrl(), report };
}
