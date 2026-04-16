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
let allData = [];       // todos os registros consolidados
let filteredData = [];  // após filtros
let tableData = [];     // agrupado por profissional+unidade
let tableSearched = []; // após busca
let currentPage = 1;
let sortColIdx = -1;
let sortAscFlag = true;

// ============================================================
// UTILITÁRIOS
// ============================================================
function norm(str) {
  if (!str) return '';
  return str.toString().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function titleCase(str) {
  if (!str) return '';
  const artigos = ['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'A', 'O', 'EM', 'NO', 'NA', 'NOS', 'NAS', 'POR', 'COM', 'PARA'];
  return str.toString().toLowerCase().split(' ').map((w, i) => {
    if (i === 0 || !artigos.includes(w.toUpperCase()))
      return w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  }).join(' ');
}

function formatCBO(nomeCBO) {
  if (!nomeCBO) return '';
  let name = nomeCBO.toString().trim();
  name = name.replace(/^M[eé]dico[:\-\s]*/i, '').trim();
  return titleCase(name);
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
  if (!date) return '';
  return MESES_PT[date.getMonth()] + '/' + date.getFullYear();
}

function mesKey(date) {
  if (!date) return 0;
  return date.getFullYear() * 100 + date.getMonth();
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
  const gviz   = `https://docs.google.com/spreadsheets/d/${SHEET.id}/gviz/tq?tqx=out:csv&gid=${SHEET.gid}`;
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
      complete: r => resolve({ rows: r.data, label: SHEET.label }),
      error: e => reject(e)
    });
  });
}

// ============================================================
// CARREGANDO DADOS DA PLANILHA...
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
      throw new Error('Nenhum dado carregado da planilha.');
    }

    allData = normalized;
    populateFilterOptions();
    applyFilters();
    setStatus(`Conectado (${allData.length.toLocaleString('pt-BR')} registros)`, true);
    updateLastUpdate();

  } catch (err) {
    console.error(err);
    showError('Erro ao carregar dados: ' + err.message);
    setStatus('Erro', false);
  }

  showLoading(false);
  if (icon) icon.classList.remove('spinning');
}

// ============================================================
// LINHAS NORMALIZADAS...
// ============================================================
function normalizeRows(rows, fonte) {
  return rows.map(row => {
    const get = (...keys) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
        const kn = norm(k);
        for (const [rk, rv] of Object.entries(row)) {
          if (norm(rk) === kn && rv !== undefined && rv !== null && rv !== '') return rv;
        }
      }
      return '';
    };

    const unidadeExec  = (get('UNIDADE EXECUTANTE') || '').toString().trim();
    const nomeCBO      = get('NOME CBO', 'CODIGO CBO', 'CÓDIGO CBO');
    const especialidade = get('ESPECIALIDADE');
    const profissional = formatProfissional(get('NOME PROFISSIONAL'));
    const cbo          = formatCBO(nomeCBO);
    const dataAgendaStr = get('DATA AGENDA', 'DATA_AGENDA');
    const dataAgenda   = parseDate(dataAgendaStr);

    return {
      unidadeExecutante: unidadeExec,
      cbo,
      nomeCBO,
      especialidade: especialidade ? titleCase(especialidade.toString()) : '',
      profissional,
      dataAgenda,
      dataAgendaStr,
      fonte
    };
  }).filter(r => r.profissional && r.unidadeExecutante);
}

// ============================================================
// POPULAR FILTROS...
// ============================================================
function populateFilterOptions() {
  const profissionais = [...new Set(allData.map(r => r.profissional).filter(Boolean))].sort();
  const unidades      = [...new Set(allData.map(r => r.unidadeExecutante).filter(Boolean))].sort();
  const cbos          = [...new Set(allData.map(r => r.cbo).filter(Boolean))].sort();

  populateSelect('filterProfissional', profissionais);
  populateSelect('filterUnidade', unidades);
  populateSelect('filterCBO', cbos);
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
// APLICAR FILTROS...
// ============================================================
function applyFilters() {
  const fProfissional = document.getElementById('filterProfissional')?.value || '';
  const fUnidade      = document.getElementById('filterUnidade')?.value || '';
  const fCBO          = document.getElementById('filterCBO')?.value || '';

  filteredData = allData.filter(r => {
    if (fProfissional && r.profissional !== fProfissional) return false;
    if (fUnidade && r.unidadeExecutante !== fUnidade) return false;
    if (fCBO && r.cbo !== fCBO) return false;
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
// KPIs...
// ============================================================
function updateKPIs() {
  const profissionaisUnicos = new Set(filteredData.map(r => r.profissional)).size;
  const unidadesUnicas = new Set(filteredData.map(r => r.unidadeExecutante)).size;
  const cbosUnicos = new Set(filteredData.map(r => r.cbo).filter(Boolean)).size;

  animateCount('kpiTotalProfissionais', profissionaisUnicos);
  animateCount('kpiUnidades', unidadesUnicas);
  animateCount('kpiCBOs', cbosUnicos);
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
// Agrupado por profissional + unidade
// Calcula o ÚLTIMO MÊS de atendimento (DATA AGENDA mais recente)
// ============================================================
function buildTableData() {
  const map = {};

  filteredData.forEach(r => {
    const key = `${r.profissional}|||${r.unidadeExecutante}`;

    if (!map[key]) {
      map[key] = {
        profissional: r.profissional,
        unidadeExecutante: r.unidadeExecutante,
        cbo: r.cbo,
        especialidade: r.especialidade,
        ultimaData: null,
        fontes: new Set()
      };
    }

    const entry = map[key];

    if (r.dataAgenda) {
      if (!entry.ultimaData || r.dataAgenda > entry.ultimaData) {
        entry.ultimaData = r.dataAgenda;
        if (r.cbo) entry.cbo = r.cbo;
        if (r.especialidade) entry.especialidade = r.especialidade;
      }
    }

    entry.fontes.add(r.fonte);
  });

  tableData = Object.values(map).map(e => ({
    ...e,
    ultimoMes: mesLabel(e.ultimaData),
    ultimoMesKey: mesKey(e.ultimaData),
    fontesStr: [...e.fontes].join(', ')
  }));

  tableData.sort((a, b) => b.ultimoMesKey - a.ultimoMesKey || a.profissional.localeCompare(b.profissional, 'pt-BR'));

  tableSearched = [...tableData];
}

// ============================================================
// FILTRO DE BUSCA NA TABELA
// ============================================================
function filterTable() {
  const q = (document.getElementById('tableSearch')?.value || '').toLowerCase();
  tableSearched = !q
    ? [...tableData]
    : tableData.filter(r =>
        (r.profissional || '').toLowerCase().includes(q) ||
        (r.unidadeExecutante || '').toLowerCase().includes(q) ||
        (r.cbo || '').toLowerCase().includes(q) ||
        (r.especialidade || '').toLowerCase().includes(q) ||
        (r.ultimoMes || '').toLowerCase().includes(q)
      );
  currentPage = 1;
  renderTable();
}

// ============================================================
// ORDENAÇÃO
// ============================================================
function sortTable(col) {
  if (sortColIdx === col) sortAscFlag = !sortAscFlag;
  else { sortColIdx = col; sortAscFlag = true; }

  const keys = ['profissional', 'unidadeExecutante', 'cbo', 'especialidade', 'ultimoMesKey'];
  const key = keys[col];

  tableSearched.sort((a, b) => {
    const va = a[key] ?? '';
    const vb = b[key] ?? '';
    const cmp = typeof va === 'number' ? va - vb : va.toString().localeCompare(vb.toString(), 'pt-BR');
    return sortAscFlag ? cmp : -cmp;
  });
  renderTable();
}

// ============================================================
// TABELA
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
    tbody.innerHTML = `<tr><td colspan="5" class="empty-msg">Nenhum registro encontrado.</td></tr>`;
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
          <td><span class="nome-profissional">${r.profissional || '–'}</span></td>
          <td><span class="nome-unidade">${r.unidadeExecutante || '–'}</span></td>
          <td>
            <div class="cbo-cell">${r.cbo || '–'}</div>
          </td>
          <td>
            <div class="esp-cell">${r.especialidade || '–'}</div>
          </td>
          <td>
            ${r.ultimoMes
              ? `<span class="badge-mes ${badgeClass}">${icone} ${r.ultimoMes}</span>`
              : '<span style="color:#aaa;font-size:0.8rem">Sem data</span>'
            }
          </td>
        </tr>
      `;
    }).join('');

    tfoot.innerHTML = `
      <tr>
        <td colspan="4"><i class="fas fa-calculator" style="margin-right:6px"></i>
          TOTAL: ${fmt(tableSearched.length)} profissional(is) / unidade(s)
        </td>
        <td></td>
      </tr>
    `;
  }

  document.getElementById('tablePaginationInfo').textContent =
    `Mostrando ${total === 0 ? 0 : start + 1} a ${Math.min(start + pageSize, total)} de ${fmt(total)} registros`;

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
        'CBO': r.cbo,
        'Especialidade': r.especialidade,
        'Último Mês de Atendimento': r.ultimoMes || 'Sem data',
        'Fontes': r.fontesStr
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(wsData);
      autoSizeColumns(ws, wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Profissionais Ativos');

      const now = new Date();
      const fname = `ProfissionaisAtivos_CMC_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch(e) {
      console.error(e);
      alert('Erro ao gerar Excel.');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-file-excel"></i> Excel';
  }, 100);
}

function autoSizeColumns(ws, data) {
  if (!data.length) return;
  const cols = Object.keys(data[0]);
  ws['!cols'] = cols.map(col => ({
    wch: Math.min(
      data.reduce((max, row) => Math.max(max, (row[col] || '').toString().length), col.length) + 2,
      60
    )
  }));
}

// ============================================================
// UTILITÁRIOS UI
// ============================================================
function showLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.toggle('hidden', !show);
}

function setStatus(msg, ok) {
  const el  = document.getElementById('statusText');
  const dot = document.querySelector('.status-dot');
  if (el)  el.textContent = msg;
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
