'use strict';

// ============================================================
// CONFIGURAÇÃO DA PLANILHA
// ============================================================
const SHEET = {
  id: '16CXd1TVf2IfTDiPzRCxUNWk6rCRoEw6WDfcybVoarnA',
  gid: '1407399146',
  label: 'Planilha Principal'
};

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ============================================================
// ESTADO GLOBAL
// ============================================================
let allData = [];
let filteredData = [];
let tableData = [];
let tableSearched = [];
let currentPage = 1;
let sortColIdx = -1;
let sortAscFlag = true;

// ============================================================
// UTILITÁRIOS
// ============================================================
function titleCase(str) {
  if (!str) return '';
  const artigos = ['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'A', 'O', 'EM', 'NO', 'NA', 'NOS', 'NAS', 'POR', 'COM', 'PARA'];
  return str.toString().toLowerCase().split(' ').map((w, i) => {
    if (i === 0 || !artigos.includes(w.toUpperCase()))
      return w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  }).join(' ');
}

function formatProfissional(nome) {
  if (!nome) return '';
  return titleCase(nome.toString().trim().replace(/^\d+\s*[-–]?\s*/, '').trim());
}

function fmt(n) {
  return (n || 0).toLocaleString('pt-BR');
}

function parseDate(str) {
  if (!str) return null;
  str = str.toString().trim();
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function mesLabel(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return '';
  return MESES_PT[date.getMonth()] + '/' + date.getFullYear();
}

function mesKey(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return 0;
  return date.getFullYear() * 100 + date.getMonth();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ============================================================
// FETCH CSV COM FALLBACK
// ============================================================
function looksLikeHtml(text) {
  if (!text) return false;
  const t = text.trim().slice(0, 200).toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.includes('<head') || t.includes('<body');
}

async function fetchCsvText(url) {
  const full = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const resp = await fetch(full, { cache: 'no-store', mode: 'cors' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

async function fetchSheet() {
  const gviz = `https://docs.google.com/spreadsheets/d/${SHEET.id}/gviz/tq?tqx=out:csv&gid=${SHEET.gid}`;
  const export_ = `https://docs.google.com/spreadsheets/d/${SHEET.id}/export?format=csv&gid=${SHEET.gid}`;

  let text = await fetchCsvText(gviz);
  if (looksLikeHtml(text)) text = await fetchCsvText(export_);
  if (looksLikeHtml(text)) throw new Error(`Planilha ${SHEET.label}: resposta HTML (verifique permissões).`);

  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: h => h.trim(),
      complete: r => {
        console.log('✅ Colunas encontradas na planilha:', Object.keys(r.data[0] || {}));
        resolve({ rows: r.data, label: SHEET.label });
      },
      error: e => reject(e)
    });
  });
}

// ============================================================
// NORMALIZAÇÃO - Mapeamento das colunas CORRETAS
// ============================================================
function normalizeRows(rows, fonte) {
  const validRows = [];
  
  for (const row of rows) {
    // Mapeamento EXATO das colunas da sua planilha
    const unidadeExecutante = row['UNIDADE EXECUTANTE'] || '';
    const unidadeSolicitante = row['UNIDADE SOLICITANTE'] || '';
    const distrito = row['DISTRITO'] || '';
    const especialidadeCBO = row['Especialidade (CBO)'] || '';
    const tipoEspecialidade = row['TIPO ESPECIALIDADE'] || '';
    const profissionalRaw = row['PROFISSIONAL'] || '';
    const profissional = formatProfissional(profissionalRaw);
    const tipoAtendimento = row['TIPO DE ATENDIMENTO'] || '';
    const situacao = row['SITUAÇÃO'] || '';
    const operador = row['OPERADOR'] || '';
    const dataAgendaStr = row['DATA DA AGENDA'] || '';
    const dataAgenda = parseDate(dataAgendaStr);
    const dataCriacaoStr = row['DATA DA CRIAÇÃO DO AGENDAMENTO'] || '';
    const dataCriacao = parseDate(dataCriacaoStr);
    const mesAgenda = row['MÊS DA AGENDA'] || '';
    
    // Pular linhas sem profissional ou sem unidade executante
    if (!profissional || !unidadeExecutante) continue;
    
    validRows.push({
      unidadeExecutante: unidadeExecutante.toString().trim(),
      unidadeSolicitante: unidadeSolicitante.toString().trim(),
      distrito: distrito.toString().trim(),
      especialidadeCBO: especialidadeCBO.toString().trim(),
      tipoEspecialidade: tipoEspecialidade.toString().trim(),
      profissional,
      tipoAtendimento: tipoAtendimento.toString().trim(),
      situacao: situacao.toString().trim(),
      operador: operador.toString().trim(),
      dataAgenda,
      dataAgendaStr,
      dataCriacao,
      dataCriacaoStr,
      mesAgenda: mesAgenda.toString().trim(),
      fonte
    });
  }
  
  console.log(`✅ Total de registros válidos: ${validRows.length}`);
  if (validRows.length > 0) {
    console.log('📋 Primeiro registro (amostra):', validRows[0]);
  }
  return validRows;
}

// ============================================================
// CARREGANDO DADOS
// ============================================================
async function loadData() {
  showLoading(true);
  setStatus('Carregando...', false);
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spinning');

  try {
    const result = await fetchSheet();
    const normalized = normalizeRows(result.rows, result.label);
    
    if (normalized.length === 0) {
      throw new Error('Nenhum dado carregado. Verifique se a planilha tem dados e as colunas estão corretas.');
    }

    allData = normalized;
    
    populateFilterOptions();
    applyFilters();
    setStatus(`Conectado ✅ (${allData.length.toLocaleString('pt-BR')} registros)`, true);
    updateLastUpdate();

  } catch (err) {
    console.error('❌ Erro:', err);
    showError('Erro ao carregar dados: ' + err.message);
    setStatus('Erro', false);
  }

  showLoading(false);
  if (icon) icon.classList.remove('spinning');
}

// ============================================================
// POPULAR FILTROS
// ============================================================
function populateFilterOptions() {
  const profissionais = [...new Set(allData.map(r => r.profissional).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const unidades = [...new Set(allData.map(r => r.unidadeExecutante).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const especialidades = [...new Set(allData.map(r => r.especialidadeCBO).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  populateSelect('filterProfissional', profissionais);
  populateSelect('filterUnidade', unidades);
  populateSelect('filterCBO', especialidades);
}

function populateSelect(id, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  values.forEach(v => {
    if (!v) return;
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

// ============================================================
// APLICAR FILTROS
// ============================================================
function applyFilters() {
  const fProfissional = document.getElementById('filterProfissional')?.value || '';
  const fUnidade = document.getElementById('filterUnidade')?.value || '';
  const fEspecialidade = document.getElementById('filterCBO')?.value || '';

  filteredData = allData.filter(r => {
    if (fProfissional && r.profissional !== fProfissional) return false;
    if (fUnidade && r.unidadeExecutante !== fUnidade) return false;
    if (fEspecialidade && r.especialidadeCBO !== fEspecialidade) return false;
    return true;
  });

  updateKPIs();
  buildTableData();
  currentPage = 1;
  renderTable();
}

function clearFilters() {
  ['filterProfissional', 'filterUnidade', 'filterCBO'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  applyFilters();
}

// ============================================================
// KPIs
// ============================================================
function updateKPIs() {
  const profissionaisUnicos = new Set(filteredData.map(r => r.profissional)).size;
  const unidadesUnicas = new Set(filteredData.map(r => r.unidadeExecutante)).size;
  const especialidadesUnicas = new Set(filteredData.map(r => r.especialidadeCBO).filter(Boolean)).size;

  animateCount('kpiTotalProfissionais', profissionaisUnicos);
  animateCount('kpiUnidades', unidadesUnicas);
  animateCount('kpiCBOs', especialidadesUnicas);
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent.replace(/\D/g, '')) || 0;
  if (current === target) { el.textContent = fmt(target); return; }
  const step = Math.max(1, Math.round(Math.abs(target - current) / 20));
  let val = current;
  const inc = target > current ? step : -step;
  const timer = setInterval(() => {
    val += inc;
    if ((inc > 0 && val >= target) || (inc < 0 && val <= target)) {
      val = target;
      clearInterval(timer);
    }
    el.textContent = fmt(val);
  }, 16);
}

// ============================================================
// AGRUPAMENTO - Último mês de atendimento baseado na DATA DA AGENDA
// ============================================================
function buildTableData() {
  const map = new Map();

  filteredData.forEach(r => {
    // Agrupa por PROFISSIONAL + UNIDADE EXECUTANTE
    const key = `${r.profissional}|||${r.unidadeExecutante}`;

    if (!map.has(key)) {
      map.set(key, {
        profissional: r.profissional,
        unidadeExecutante: r.unidadeExecutante,
        unidadeSolicitante: r.unidadeSolicitante,
        distrito: r.distrito,
        especialidadeCBO: r.especialidadeCBO,
        tipoEspecialidade: r.tipoEspecialidade,
        ultimaData: null,
        tipoAtendimento: r.tipoAtendimento,
        situacao: r.situacao,
        operador: r.operador,
        mesAgenda: r.mesAgenda
      });
    }

    const entry = map.get(key);

    // Atualiza a data mais recente para este profissional/unidade
    if (r.dataAgenda) {
      if (!entry.ultimaData || r.dataAgenda > entry.ultimaData) {
        entry.ultimaData = r.dataAgenda;
        // Atualiza outros campos com base no registro mais recente
        if (r.especialidadeCBO) entry.especialidadeCBO = r.especialidadeCBO;
        if (r.tipoEspecialidade) entry.tipoEspecialidade = r.tipoEspecialidade;
        if (r.unidadeSolicitante) entry.unidadeSolicitante = r.unidadeSolicitante;
        if (r.distrito) entry.distrito = r.distrito;
      }
    }
  });

  tableData = Array.from(map.values()).map(e => ({
    ...e,
    ultimoMes: mesLabel(e.ultimaData),
    ultimoMesKey: mesKey(e.ultimaData)
  }));

  // Ordenação inicial: mais recente primeiro
  tableData.sort((a, b) => b.ultimoMesKey - a.ultimoMesKey || a.profissional.localeCompare(b.profissional, 'pt-BR'));
  tableSearched = [...tableData];
  
  console.log(`✅ Total de profissionais/unidades agrupados: ${tableData.length}`);
}

// ============================================================
// FILTRO DE BUSCA NA TABELA
// ============================================================
function filterTable() {
  const q = (document.getElementById('tableSearch')?.value || '').toLowerCase().trim();
  if (!q) {
    tableSearched = [...tableData];
  } else {
    tableSearched = tableData.filter(r =>
      (r.profissional || '').toLowerCase().includes(q) ||
      (r.unidadeExecutante || '').toLowerCase().includes(q) ||
      (r.unidadeSolicitante || '').toLowerCase().includes(q) ||
      (r.distrito || '').toLowerCase().includes(q) ||
      (r.especialidadeCBO || '').toLowerCase().includes(q) ||
      (r.tipoEspecialidade || '').toLowerCase().includes(q) ||
      (r.ultimoMes || '').toLowerCase().includes(q)
    );
  }
  currentPage = 1;
  renderTable();
}

// ============================================================
// ORDENAÇÃO DA TABELA
// ============================================================
function sortTable(col) {
  const keys = [
    'profissional',
    'unidadeExecutante',
    'unidadeSolicitante',
    'distrito',
    'especialidadeCBO',
    'tipoEspecialidade',
    'ultimoMesKey'
  ];
  
  if (sortColIdx === col) {
    sortAscFlag = !sortAscFlag;
  } else {
    sortColIdx = col;
    sortAscFlag = true;
  }
  const key = keys[col];

  tableSearched.sort((a, b) => {
    let va = a[key] ?? '';
    let vb = b[key] ?? '';
    
    if (key === 'ultimoMesKey') {
      const cmp = (va || 0) - (vb || 0);
      return sortAscFlag ? cmp : -cmp;
    }
    
    va = va.toString();
    vb = vb.toString();
    const cmp = va.localeCompare(vb, 'pt-BR', { sensitivity: 'base' });
    return sortAscFlag ? cmp : -cmp;
  });
  
  renderTable();
}

// ============================================================
// RENDERIZAÇÃO DA TABELA
// ============================================================
function renderTable() {
  const pageSize = parseInt(document.getElementById('tablePageSize')?.value || 15);
  const total = tableSearched.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > pages) currentPage = pages;

  const start = (currentPage - 1) * pageSize;
  const slice = tableSearched.slice(start, start + pageSize);

  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');

  const hoje = new Date();
  const mesAtualKey = hoje.getFullYear() * 100 + hoje.getMonth();
  const mesAnteriorKey = hoje.getMonth() === 0
    ? (hoje.getFullYear() - 1) * 100 + 11
    : hoje.getFullYear() * 100 + (hoje.getMonth() - 1);

  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-msg">Nenhum registro encontrado.</td></tr>`;
    tfoot.innerHTML = '';
  } else {
    tbody.innerHTML = slice.map(r => {
      let badgeClass = '';
      if (r.ultimoMesKey >= mesAtualKey) badgeClass = 'recente';
      else if (r.ultimoMesKey >= mesAnteriorKey) badgeClass = '';
      else badgeClass = 'antigo';

      const icone = badgeClass === 'recente'
        ? '<i class="fas fa-circle-check" style="font-size:0.7rem"></i>'
        : badgeClass === 'antigo'
          ? '<i class="fas fa-clock" style="font-size:0.7rem"></i>'
          : '<i class="fas fa-calendar" style="font-size:0.7rem"></i>';

      return `
        <tr>
          <td><span class="nome-profissional">${escapeHtml(r.profissional) || '–'}</span></td>
          <td><span class="nome-unidade">${escapeHtml(r.unidadeExecutante) || '–'}</span></td>
          <td>${escapeHtml(r.unidadeSolicitante) || '–'}</td>
          <td>${escapeHtml(r.distrito) || '–'}</td>
          <td><div class="cbo-cell">${escapeHtml(r.especialidadeCBO) || '–'}</div></td>
          <td>${escapeHtml(r.tipoEspecialidade) || '–'}</td>
          <td>
            ${r.ultimoMes
              ? `<span class="badge-mes ${badgeClass}">${icone} ${escapeHtml(r.ultimoMes)}</span>`
              : '<span style="color:#aaa;font-size:0.8rem">Sem data</span>'
            }
            </td>
        </tr>
      `;
    }).join('');

    tfoot.innerHTML = `
      <tr>
        <td colspan="6"><i class="fas fa-calculator" style="margin-right:6px"></i>
          TOTAL: ${fmt(tableSearched.length)} profissional(is) / unidade(s)
        </td>
        <td></td>
      </tr>
    `;
  }

  const infoEl = document.getElementById('tablePaginationInfo');
  if (infoEl) {
    infoEl.textContent = `Mostrando ${total === 0 ? 0 : start + 1} a ${Math.min(start + pageSize, total)} de ${fmt(total)} registros`;
  }
  renderPagination(currentPage, pages);
}

// ============================================================
// PAGINAÇÃO
// ============================================================
function renderPagination(cur, total) {
  const container = document.getElementById('pagination');
  if (!container) return;

  let html = `<button class="page-btn" onclick="goPage(${cur - 1})" ${cur === 1 ? 'disabled' : ''}>‹</button>`;

  let pages = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages = [1];
    if (cur > 3) pages.push('...');
    for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) pages.push(i);
    if (cur < total - 2) pages.push('...');
    pages.push(total);
  }

  pages.forEach(p => {
    if (p === '...') html += `<button class="page-btn" disabled>…</button>`;
    else html += `<button class="page-btn ${p === cur ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
  });

  html += `<button class="page-btn" onclick="goPage(${cur + 1})" ${cur === total ? 'disabled' : ''}>›</button>`;
  container.innerHTML = html;
}

function goPage(p) {
  const pageSize = parseInt(document.getElementById('tablePageSize')?.value || 15);
  const pages = Math.max(1, Math.ceil(tableSearched.length / pageSize));
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
}

// ============================================================
// EXPORTAR EXCEL
// ============================================================
function exportExcel() {
  if (!tableData.length) { alert('Nenhum dado para exportar.'); return; }

  const btn = document.getElementById('btnExcel');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';

  setTimeout(() => {
    try {
      const wsData = tableSearched.map(r => ({
        'Profissional': r.profissional,
        'Unidade Executante': r.unidadeExecutante,
        'Unidade Solicitante': r.unidadeSolicitante,
        'Distrito': r.distrito,
        'Especialidade (CBO)': r.especialidadeCBO,
        'Tipo Especialidade': r.tipoEspecialidade,
        'Último Mês de Atendimento': r.ultimoMes || 'Sem data'
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(wsData);
      
      const colWidths = [
        { wch: 35 }, // Profissional
        { wch: 30 }, // Unidade Executante
        { wch: 30 }, // Unidade Solicitante
        { wch: 20 }, // Distrito
        { wch: 35 }, // Especialidade
        { wch: 25 }, // Tipo Especialidade
        { wch: 25 }  // Último Mês
      ];
      ws['!cols'] = colWidths;
      
      XLSX.utils.book_append_sheet(wb, ws, 'Profissionais Ativos');

      const now = new Date();
      const fname = `ProfissionaisAtivos_CMC_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar Excel.');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-file-excel"></i> Excel';
  }, 100);
}

// ============================================================
// UI UTILITIES
// ============================================================
function showLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.toggle('hidden', !show);
}

function setStatus(msg, ok) {
  const el = document.getElementById('statusText');
  const dot = document.querySelector('.status-dot');
  if (el) el.textContent = msg;
  if (dot) dot.className = 'status-dot ' + (ok ? 'connected' : 'error');
}

function showError(msg) {
  setStatus('Erro', false);
  showLoading(false);
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9998;
    background:#c0392b;color:#fff;border-radius:12px;
    padding:14px 22px;font-family:Inter,sans-serif;font-size:.85rem;
    font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.3);
    display:flex;align-items:center;gap:10px;max-width:420px;
  `;
  toast.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

function updateLastUpdate() {
  const el = document.getElementById('lastUpdate');
  if (el) el.textContent = `Última atualização: ${new Date().toLocaleString('pt-BR')}`;
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});
