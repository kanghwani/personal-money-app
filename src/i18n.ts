import { LANG } from './classifyRules'

export function makeT(dict: Record<string, string>) {
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = dict[key] ?? key
    if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, String(vars[k]))
    return s
  }
}

export const ko: Record<string, string> = {
  // 앱 셸 / 헤더
  app_title: '돈 정리',
  nav_screens: '화면',
  sync_syncing: '동기화 중',
  sync_offline: '오프라인',
  sync_error: '동기화 오류',
  sync_synced: '동기화됨',
  pwa_add_title: "홈 화면에 '돈 정리' 추가하기",
  pwa_pre: '하단 ',
  pwa_share_button: '공유 버튼',
  pwa_mid: '을 누른 후, ',
  pwa_add_home: "'홈 화면에 추가'",
  pwa_post: '를 탭하면 완전한 앱으로 사용할 수 있습니다.',

  // 탭
  tab_home: '홈', tab_ledger: '원장', tab_assets: '자산', tab_insights: '인사이트', tab_fixed: '고정비',

  // 공통 버튼
  btn_input: '입력', btn_edit: '수정', btn_delete: '삭제', btn_close: '닫기', btn_sync: '동기화', btn_export: '내보내기',
  btn_undo: '되돌리기', btn_classify: '분류', btn_add: '+ 추가', btn_save: '저장',

  // 필터/세그먼트
  filter_income: '수입', filter_expense: '지출', filter_all: '전체',
  view_list: '목록', view_calendar: '달력',
  prev_month: '이전 달', next_month: '다음 달',

  // 빠른입력
  qe_placeholder: '금액 장소 물건 · +면 수입',
  quick_input_aria: '빠른입력',
  day_input_placeholder: '점심 9000 카드',

  // 섹션 타이틀
  sec_fixed_variable: '고정비 / 변동비', sec_place_top: '장소 TOP', sec_delta: '전월대비', sec_month_flow: '월별 흐름', sec_spend_ratio: '지출 비중',

  // 고정비 화면
  fixed_income_title: '월 정기수입', fixed_expense_title: '월 고정비',
  empty_fixed: '고정비가 없습니다. + 추가로 등록하세요.', empty_income: '정기수입이 없습니다. + 추가로 등록하세요.',
  fixed_kind_income: '정기수입', fixed_kind_expense: '고정비', fixed_action_add: '추가',
  fixed_sheet_title: '{kind} {action}',
  monthly_day: '매월 {day}일',
  split_and_real: ' · 분담 {split} · 실지출 {real}',
  need_check: ' · 확인필요',
  done_suffix: ' · 완료',
  remaining_progress: ' · {count}/{total}회 · {label} {amt}',
  label_to_receive: '받을',
  label_remaining: '남은',
  toggle_active_aria: '활성 토글',

  loading: '불러오는 중…',
  saving: '저장 중…',

  // 공용 상태/빈 상태
  not_entered: '미입력',
  unspecified: '미지정',
  uncategorized: '미분류',
  no_transactions: '거래가 없습니다.',
  no_transactions_add_above: '거래가 없습니다. 위에서 추가하세요.',
  uncategorized_prompt: '미분류 — 카테고리를 골라주세요',
  amount_count: '{amt} · {n}건',

  // 토스트
  status_ready: '준비됨',
  status_classifying: '분류 반영 중…',
  status_classified: '분류 반영됨',
  status_classify_failed: '분류 실패',
  toast_chip_recorded: '{label} {amt} 기록',
  toast_recorded_done: '{memo} {amt} 기록됨',
  toast_classified_auto: '{cat}로 분류됨 · 다음부터 자동',
  toast_asset_saved: '{name} 자산 저장',
  toast_asset_updated: '{name} 자산 갱신',
  toast_investment_updated: '투자 {n}건 갱신',
  toast_loan_updated: '{name} 대출 갱신',

  // 에러 메시지
  err_no_input: '입력값 없음',
  err_amount_not_found: '금액을 찾지 못함',
  err_asset_amount_not_found: '자산 금액을 찾지 못함',
  err_investment_not_found: '투자 항목을 찾지 못함',
  err_loan_balance_not_found: '대출 잔액을 찾지 못함',

  // 요일
  wd_sun: '일', wd_mon: '월', wd_tue: '화', wd_wed: '수', wd_thu: '목', wd_fri: '금', wd_sat: '토',

  // 카테고리 상세 시트
  this_month_real_spend: '이번 달 실지출',
  vs_prev_month: '전월 대비 {sign}{pct}%',

  // 자산 화면
  net_worth: '순자산',
  assets_label_amt: '자산 {amt}',
  liabilities_label_amt: '부채 {amt}',
  investments_title: '투자',
  loans_title: '대출',
  monthly_amt: '월 {amt}',
  asset_edit_title: '자산 수정',
  asset_add_title: '자산 추가',
  manual_input: '직접 입력',
  placeholder_kind: '구분',
  placeholder_institution: '기관',

  // 인사이트 화면(차트/툴팁)
  real_spend: '실지출',
  spend_amount: '지출액',
  delta_no_data: '비교할 전월 데이터가 쌓이는 중이에요.',
  new_badge: 'NEW',

  // buildInsights 카드
  insight_balance_title: '이번 달 수지',
  insight_balance_body_pos: '수입 {income} − 지출 {spend} = {net} · 저축률 {rate}',
  insight_balance_body_neg: '수입 {income} − 지출 {spend} = {net} · 적자예요',
  insight_balance_body_noincome: '이번 달 실지출 {spend}. 수입을 등록하면 저축률도 보여드려요.',
  insight_variable_title: '쓸 수 있는 돈 (변동 지출)',
  insight_variable_body_base: '고정비 빼고 {amt} 썼어요.',
  insight_variable_body_prev: ' 전월 변동은 {amt}.',
  insight_variable_body_tail: ' 여기가 줄일 수 있는 부분이에요.',
  insight_max_var_title: '이번 달 최대 변동 지출',
  insight_max_var_body: '{memo} · {amt} ({cat}). 고정비 빼고 가장 큰 한 건이에요.',
  insight_top_var_cat_title: '변동 지출 1위',
  insight_top_var_cat_body: '{cat} {amt} — 변동 지출 중 가장 컸어요. 줄일 여지가 있는지 살펴보세요.',
  insight_fixed_burden_title: '고정비 부담',
  insight_fixed_burden_body_income: '고정비 {amt} · 수입의 {pct}를 차지해요.',
  insight_fixed_burden_body_noincome: '이번 달 고정비는 {amt}예요.',
  insight_investment_title: '투자 현황',
  insight_investment_body_loss: ' — 손실 구간이에요.',
  insight_investment_body_gain: ' — 수익 중이에요.',
  insight_diligence_title: '입력 성실도',
  insight_diligence_body_missing: '이번 달 결제수단 미입력 {n}건. 채워두면 더 정확해져요.',
  insight_diligence_body_clean: '이번 달 기록 깔끔해요 👍',

  // 고정/변동 라벨
  fixed_type_fixed: '고정',
  fixed_type_variable: '변동',
  label_fixed_cost: '고정비',
  label_variable_cost: '변동비',
  fixed_variable_ratio_aria: '고정비 변동비 비중',

  // 거래 수정 시트
  tx_edit_title: '거래 수정',
  field_name: '이름',
  field_amount: '금액',
  field_category: '대분류',
  field_subcategory: '소분류',
  field_deposit_method: '입금수단',
  field_payment_method: '결제수단',
  field_split_amount: '분담금(여친 부담분 등, 없으면 0)',
  field_pay_day: '납부일',
  field_start_month: '시작월(yyyy-MM)',
  field_installment_total: '할부 총회차(없으면 비움)',
  field_variable_note: '변동 항목 (금액이 매달 바뀜 — 자동입력 시 ‘확인필요’ 표시)',
  field_place: '장소',
  field_item: '물건',
  field_date: '날짜',
  field_type: '구분',
  field_fixed_variable: '고정/변동',
  field_split: '분담금',
  placeholder_place_example: '예: 다이소',
  placeholder_item_example: '예: 청소용품',
  placeholder_select_or_type: '선택 또는 직접 입력',
  auto_classify_prefix: '자동 분류: ',
  edit_suffix: ' · 수정 ▾',
  opt_variable: '변동',
  opt_fixed: '고정',

  // 날짜 라벨
  date_label: '{month}월 {day}일',
}

export const es: Record<string, string> = {
  app_title: 'Mis Finanzas',
  nav_screens: 'Pantallas',
  sync_syncing: 'Sincronizando',
  sync_offline: 'Sin conexión',
  sync_error: 'Error de sincronización',
  sync_synced: 'Sincronizado',
  pwa_add_title: "Añadir 'Mis Finanzas' a la pantalla de inicio",
  pwa_pre: 'Toca el botón de ',
  pwa_share_button: 'Compartir',
  pwa_mid: ' de abajo y luego ',
  pwa_add_home: "'Añadir a pantalla de inicio'",
  pwa_post: ' para usarla como app completa.',

  tab_home: 'Inicio', tab_ledger: 'Registro', tab_assets: 'Activos', tab_insights: 'Análisis', tab_fixed: 'Fijos',

  btn_input: 'Añadir', btn_edit: 'Editar', btn_delete: 'Borrar', btn_close: 'Cerrar', btn_sync: 'Sincronizar', btn_export: 'Exportar',
  btn_undo: 'Deshacer', btn_classify: 'Clasificar', btn_add: '+ Añadir', btn_save: 'Guardar',

  filter_income: 'Ingresos', filter_expense: 'Gastos', filter_all: 'Todo',
  view_list: 'Lista', view_calendar: 'Calendario',
  prev_month: 'Mes anterior', next_month: 'Mes siguiente',

  qe_placeholder: 'Monto lugar cosa · + para ingreso',
  quick_input_aria: 'Entrada rápida',
  day_input_placeholder: 'Almuerzo 9000 tarjeta',

  sec_fixed_variable: 'Fijos / Variables', sec_place_top: 'Lugares TOP', sec_delta: 'vs. mes anterior', sec_month_flow: 'Flujo mensual', sec_spend_ratio: 'Distribución de gastos',

  fixed_income_title: 'Ingresos fijos', fixed_expense_title: 'Gastos fijos',
  empty_fixed: 'No hay gastos fijos. Añade con +.', empty_income: 'No hay ingresos fijos. Añade con +.',
  fixed_kind_income: 'Ingreso fijo', fixed_kind_expense: 'Gasto fijo', fixed_action_add: 'Añadir',
  fixed_sheet_title: '{kind} {action}',
  monthly_day: 'día {day} de cada mes',
  split_and_real: ' · Compartido {split} · Gasto real {real}',
  need_check: ' · revisar',
  done_suffix: ' · Completado',
  remaining_progress: ' · {count}/{total} · {label} {amt}',
  label_to_receive: 'por cobrar',
  label_remaining: 'restante',
  toggle_active_aria: 'Alternar activo',

  loading: 'Cargando…',
  saving: 'Guardando…',

  not_entered: 'Sin especificar',
  unspecified: 'Sin especificar',
  uncategorized: 'Sin clasificar',
  no_transactions: 'No hay movimientos.',
  no_transactions_add_above: 'No hay movimientos. Añade uno arriba.',
  uncategorized_prompt: 'Sin categoría — elige una categoría',
  amount_count: '{amt} · {n} movimientos',

  status_ready: 'Listo',
  status_classifying: 'Clasificando…',
  status_classified: 'Clasificado',
  status_classify_failed: 'Error al clasificar',
  toast_chip_recorded: '{label} {amt} registrado',
  toast_recorded_done: '{memo} {amt} registrado',
  toast_classified_auto: 'Clasificado como {cat} · automático desde ahora',
  toast_asset_saved: '{name} guardado',
  toast_asset_updated: '{name} activo actualizado',
  toast_investment_updated: '{n} inversiones actualizadas',
  toast_loan_updated: '{name} préstamo actualizado',

  err_no_input: 'Sin entrada',
  err_amount_not_found: 'No se encontró el monto',
  err_asset_amount_not_found: 'No se encontró el monto del activo',
  err_investment_not_found: 'No se encontró la inversión',
  err_loan_balance_not_found: 'No se encontró el saldo del préstamo',

  wd_sun: 'D', wd_mon: 'L', wd_tue: 'M', wd_wed: 'X', wd_thu: 'J', wd_fri: 'V', wd_sat: 'S',

  this_month_real_spend: 'Gasto real este mes',
  vs_prev_month: '{sign}{pct}% vs. mes anterior',

  net_worth: 'Patrimonio neto',
  assets_label_amt: 'Activos {amt}',
  liabilities_label_amt: 'Pasivos {amt}',
  investments_title: 'Inversiones',
  loans_title: 'Préstamos',
  monthly_amt: '{amt}/mes',
  asset_edit_title: 'Editar activo',
  asset_add_title: 'Añadir activo',
  manual_input: 'Entrada manual',
  placeholder_kind: 'Tipo',
  placeholder_institution: 'Institución',

  real_spend: 'Gasto real',
  spend_amount: 'Monto de gasto',
  delta_no_data: 'Aún no hay datos del mes anterior para comparar.',
  new_badge: 'NUEVO',

  insight_balance_title: 'Balance de este mes',
  insight_balance_body_pos: 'Ingresos {income} − Gastos {spend} = {net} · Tasa de ahorro {rate}',
  insight_balance_body_neg: 'Ingresos {income} − Gastos {spend} = {net} · Estás en déficit',
  insight_balance_body_noincome: 'Gasto real de este mes: {spend}. Registra tus ingresos para ver la tasa de ahorro.',
  insight_variable_title: 'Dinero disponible (gasto variable)',
  insight_variable_body_base: 'Gastaste {amt} sin contar los fijos.',
  insight_variable_body_prev: ' El variable del mes anterior fue {amt}.',
  insight_variable_body_tail: ' Aquí es donde puedes recortar.',
  insight_max_var_title: 'Mayor gasto variable de este mes',
  insight_max_var_body: '{memo} · {amt} ({cat}). El gasto variable más grande, sin contar los fijos.',
  insight_top_var_cat_title: 'Top 1 en gasto variable',
  insight_top_var_cat_body: '{cat} {amt} — lo más grande en gasto variable. Revisa si puedes recortarlo.',
  insight_fixed_burden_title: 'Carga de gastos fijos',
  insight_fixed_burden_body_income: 'Gastos fijos {amt} · {pct} de tus ingresos.',
  insight_fixed_burden_body_noincome: 'Los gastos fijos de este mes son {amt}.',
  insight_investment_title: 'Estado de inversiones',
  insight_investment_body_loss: ' — en pérdida.',
  insight_investment_body_gain: ' — en ganancia.',
  insight_diligence_title: 'Constancia de registro',
  insight_diligence_body_missing: 'Método de pago sin registrar en {n} movimientos este mes. Complétalo para más precisión.',
  insight_diligence_body_clean: '¡Tus registros de este mes están impecables! 👍',

  fixed_type_fixed: 'Fijo',
  fixed_type_variable: 'Variable',
  label_fixed_cost: 'Gastos fijos',
  label_variable_cost: 'Gastos variables',
  fixed_variable_ratio_aria: 'Proporción fijo/variable',

  tx_edit_title: 'Editar movimiento',
  field_name: 'Nombre',
  field_amount: 'Monto',
  field_category: 'Categoría',
  field_subcategory: 'Subcategoría',
  field_deposit_method: 'Método de ingreso',
  field_payment_method: 'Método de pago',
  field_split_amount: 'Monto compartido (parte de tu pareja, etc.; 0 si no aplica)',
  field_pay_day: 'Día de pago',
  field_start_month: 'Mes de inicio (aaaa-MM)',
  field_installment_total: 'Total de cuotas (vacío si no aplica)',
  field_variable_note: "Elemento variable (el monto cambia cada mes — se marcará 'revisar' en la entrada automática)",
  field_place: 'Lugar',
  field_item: 'Artículo',
  field_date: 'Fecha',
  field_type: 'Tipo',
  field_fixed_variable: 'Fijo/Variable',
  field_split: 'Monto compartido',
  placeholder_place_example: 'Ej: Daiso',
  placeholder_item_example: 'Ej: artículos de limpieza',
  placeholder_select_or_type: 'Elige o escribe directamente',
  auto_classify_prefix: 'Clasificación automática: ',
  edit_suffix: ' · Editar ▾',
  opt_variable: 'Variable',
  opt_fixed: 'Fijo',

  date_label: '{day}/{month}',
}

export const t = makeT(LANG === 'es' ? es : ko)
