require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('FALTANDO SUPABASE_URL ou SUPABASE_SERVICE_KEY no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TZ = 'America/Sao_Paulo';
const SP_OFFSET = '-03:00';

app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'segredo-padrao-troque',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

/* ------------------------- helpers ------------------------- */

function dateUTC(y, m, d, hh = 0, mm = 0) {
  return new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${SP_OFFSET}`);
}

function partesSp(d) {
  const map = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date(d))
    .forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
  return map;
}

function inicioDoDiaSp(offsetDias = 0) {
  const p = partesSp(Date.now());
  const d = dateUTC(p.year, p.month, p.day);
  if (offsetDias) d.setDate(d.getDate() + offsetDias);
  return d;
}

function dayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

function hourKey(d) {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(d)), 10) % 24;
}

function weekdayName(d) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long' }).format(new Date(d));
}

function fmtData(d) {
  const p = partesSp(d);
  return `${p.day}/${p.month}/${p.year}`;
}

function fmtHora(d) {
  const p = partesSp(d);
  return `${p.hour}:${p.minute}`;
}

function maskPhone(tel) {
  const t = String(tel || '');
  const clean = t.replace(/\D/g, '');
  return clean.length >= 4 ? `•••• ${clean.slice(-4)}` : '••••';
}

function limpaResumo(texto) {
  return String(texto || '').replace(/^\s*ERROR:.*$/gim, '').trim();
}

function previewResumo(texto, max = 150) {
  const limpo = limpaResumo(texto).replace(/\s+/g, ' ');
  if (!limpo) return '';
  return limpo.length > max ? limpo.slice(0, max) + '…' : limpo;
}

/* ------------------------- dados ------------------------- */

async function carregaDados(dias) {
  const agora = new Date();
  const from = dias > 0 ? new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000) : new Date('2000-01-01T00:00:00Z');
  const fromISO = from.toISOString();
  const inicioHoje = inicioDoDiaSp();

  // -- PACIENTES (tabela chats: 1 linha por telefone cadastrado)
  const { data: chats } = await supabase.from('chats').select('*').order('created_at', { ascending: true });

  const porTel = new Map();
  for (const c of chats || []) {
    if (!c.phone) continue;
    const t = String(c.phone);
    const d = new Date(c.created_at);
    const cur = porTel.get(t);
    if (!cur) {
      porTel.set(t, { tel: t, primeiro: d, ultimo: d, linha: c });
    } else {
      if (d < cur.primeiro) {
        cur.primeiro = d;
        cur.tel = t;
      }
      if (d > cur.ultimo) {
        cur.ultimo = d;
        cur.linha = c;
      }
    }
  }

  const todos = [...porTel.values()];
  const ativosNoPeriodo = todos.filter((p) => p.ultimo >= from);
  const novos = ativosNoPeriodo.filter((p) => p.primeiro >= from).length;
  const recorrentes = ativosNoPeriodo.length - novos;
  const totalPacientes = todos.length;

  // novos por dia
  const contatosPorDiaMap = new Map();
  for (const p of todos) {
    if (p.primeiro < from) continue;
    const k = dayKey(p.primeiro);
    contatosPorDiaMap.set(k, (contatosPorDiaMap.get(k) || 0) + 1);
  }
  const contatosPorDia = [...contatosPorDiaMap.entries()].map(([dia, total]) => ({ dia: dia.slice(8, 10) + '/' + dia.slice(5, 7), total }));

  // ultimos contatos (com resumo da conversa vindo de chats.memoria_contexto)
  const ultimosContatos = todos
    .sort((a, b) => b.ultimo - a.ultimo)
    .slice(0, 8)
    .map((p) => ({
      telefone: p.tel,
      telefone_mascarado: maskPhone(p.tel),
      nome: p.linha?.nome || null,
      data: fmtData(p.ultimo),
      resumo: previewResumo(p.linha?.memoria_contexto),
    }));

  // -- STATUS IA
  let iaPausada = 0;
  for (const c of chats || []) {
    if (String(c.ai_service || '').toLowerCase().includes('pause')) iaPausada++;
  }
  const iaAtiva = totalPacientes - iaPausada;

  // -- EVENTOS DE MENSAGEM (tabela contatos - opcional)
  const { data: eventos } = await supabase
    .from('contatos')
    .select('telefone, api_type, tipo_mensagem, created_at')
    .gte('created_at', fromISO);

  const distribuicaoApi = new Map();
  const distribuicaoMidia = new Map();
  const temEventos = Array.isArray(eventos) && eventos.length > 0;
  if (temEventos) {
    for (const e of eventos) {
      const api = e.api_type || 'desconhecida';
      const midia = e.tipo_mensagem || 'texto';
      distribuicaoApi.set(api, (distribuicaoApi.get(api) || 0) + 1);
      distribuicaoMidia.set(midia, (distribuicaoMidia.get(midia) || 0) + 1);
    }
  }
  const distribuicaoApiArr = [...distribuicaoApi.entries()].map(([nome, total]) => ({ nome, total }));
  const distribuicaoMidiaArr = [...distribuicaoMidia.entries()].map(([nome, total]) => ({ nome, total }));

  // -- AGENDAMENTOS
  const { data: agendamentos } = await supabase.from('agendamentos').select('tipo, inicio, status, titulo').order('inicio', { ascending: true });

  const agendadosNaoCancelados = (agendamentos || []).filter((a) => a.inicio && a.status !== 'cancelado');

  // agendados com data dentro do periodo (para conversao e graficos)
  const agendadosPeriodo = agendadosNaoCancelados.filter((a) => {
    const d = new Date(a.inicio);
    return d >= from && d <= agora;
  });

  const agendaHoje = inicioDoDiaSp();
  const agendaFimHoje = inicioDoDiaSp(1);
  const agendaFimSemana = inicioDoDiaSp(7);

  const hojeCount = agendadosNaoCancelados.filter((a) => {
    const d = new Date(a.inicio);
    return d >= agendaHoje && d < agendaFimHoje;
  }).length;

  const proximos7dCount = agendadosNaoCancelados.filter((a) => {
    const d = new Date(a.inicio);
    return d >= agora && d < agendaFimSemana;
  }).length;

  const proximos = agendadosNaoCancelados
    .filter((a) => new Date(a.inicio) >= agora)
    .slice(0, 20)
    .map((a) => ({
      data: fmtData(a.inicio),
      hora: fmtHora(a.inicio),
      titulo: a.titulo || 'Sem titulo',
      tipo: a.tipo || 'outro',
    }));

  let consultaPeriodo = 0;
  let examePeriodo = 0;
  let outrosPeriodo = 0;
  const agendamentosPorDiaMap = new Map();
  const porDiaSemanaMap = new Map();
  const porHoraMap = new Map();

  for (const a of agendadosPeriodo) {
    const tipo = a.tipo || 'outro';
    if (tipo === 'consulta') consultaPeriodo++;
    else if (tipo === 'exame') examePeriodo++;
    else outrosPeriodo++;

    const d = new Date(a.inicio);
    const k = dayKey(d);
    const cur = agendamentosPorDiaMap.get(k) || { dia: k.slice(8, 10) + '/' + k.slice(5, 7), consulta: 0, exame: 0, outro: 0 };
    if (tipo === 'consulta') cur.consulta++;
    else if (tipo === 'exame') cur.exame++;
    else cur.outro++;
    agendamentosPorDiaMap.set(k, cur);

    const wk = weekdayName(d);
    porDiaSemanaMap.set(wk, (porDiaSemanaMap.get(wk) || 0) + 1);

    const h = hourKey(d);
    porHoraMap.set(h, (porHoraMap.get(h) || 0) + 1);
  }

  const agendamentosPorDia = [...agendamentosPorDiaMap.values()];
  const porDiaSemana = [...porDiaSemanaMap.entries()].map(([dia, total]) => ({ dia, total }));
  const porHora = [...porHoraMap.entries()].map(([hora, total]) => ({ hora, total })).sort((a, b) => a.hora - b.hora);

  const agendadosPeriodoTotal = consultaPeriodo + examePeriodo + outrosPeriodo;
  const taxaConversao = novos > 0 ? Math.round((agendadosPeriodoTotal / novos) * 1000) / 10 : 0;

  return {
    hoje: dayKey(agora),
    resumo: {
      contatosPeriodo: ativosNoPeriodo.length,
      novos,
      recorrentes,
      totalPacientes,
      agendadosPeriodo: agendadosPeriodoTotal,
      consultaPeriodo,
      examePeriodo,
      outrosPeriodo,
      hojeCount,
      proximos7dCount,
      taxaConversao,
      iaAtiva,
      iaPausada,
      temEventos,
    },
    contatosPorDia,
    agendamentosPorDia,
    porDiaSemana,
    porHora,
    distribuicaoApi: distribuicaoApiArr,
    distribuicaoMidia: distribuicaoMidiaArr,
    distribuicaoTipo: [
      { nome: 'consulta', total: consultaPeriodo },
      { nome: 'exame', total: examePeriodo },
      { nome: 'outro', total: outrosPeriodo },
    ],
    proximos,
    ultimosContatos,
  };
}

/* ------------------------- rotas ------------------------- */

function precisaLogin(req, res, next) {
  if (req.session && req.session.auth) return next();
  return res.status(401).json({ error: 'nao_autenticado' });
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  if (String(req.body.password || '') === DASHBOARD_PASSWORD) {
    req.session.auth = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'senha_incorreta' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => res.json({ auth: !!(req.session && req.session.auth) }));

app.get('/api/dados', precisaLogin, async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias || '30', 10), 0), 3650);
  try {
    const dados = await carregaDados(dias);
    res.json(dados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro_ao_buscar_dados' });
  }
});

app.get('/api/paciente/:telefone', precisaLogin, async (req, res) => {
  try {
    const tel = req.params.telefone;

    const { data: pacienteArr } = await supabase.from('chats').select('*').eq('phone', tel);
    const paciente = (pacienteArr || [])[0] || null;

    const { data: hist } = await supabase
      .from('n8n_chat_histories')
      .select('message, id')
      .eq('session_id', tel)
      .order('id', { ascending: true });

    const mensagens = (hist || [])
      .map((h) => {
        let m = h.message;
        if (typeof m === 'string') {
          try {
            m = JSON.parse(m);
          } catch {
            m = null;
          }
        }
        return {
          papel: m && m.type === 'ai' ? 'ai' : 'human',
          conteudo: m && m.content ? String(m.content) : '',
        };
      })
      .filter((x) => x.conteudo.trim());

    res.json({
      paciente: paciente
        ? { nome: paciente.nome || null, telefone: tel, telefone_mascarado: maskPhone(tel) }
        : null,
      resumo: paciente ? limpaResumo(paciente.memoria_contexto) : '',
      mensagens,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro_ao_buscar_paciente' });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, () => console.log(`Dashboard rodando na porta ${PORT}`));