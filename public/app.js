(() => {
  const $ = (sel) => document.querySelector(sel);

  const telaLogin = $('#tela-login');
  const app = $('#app');
  const formLogin = $('#form-login');
  const senhaInput = $('#senha');
  const erroLogin = $('#erro-login');
  const btnSair = $('#btn-sair');
  const chips = document.querySelectorAll('.chip');

  let periodo = 30;
  const graficos = {};

  function novoGrafico(chave, config) {
    if (graficos[chave]) {
      graficos[chave].destroy();
      delete graficos[chave];
    }
    graficos[chave] = new Chart($(chave), config);
  }

  const cores = {
    consulta: 'rgba(14, 124, 102, 1)',
    exame: 'rgba(37, 99, 235, 1)',
    outro: 'rgba(148, 163, 184, 1)',
  };

  const paletaBarra = ['#0e7c66', '#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#a3e635'];
  const paletaDona = [cores.consulta, cores.exame, cores.outro, '#06b6d4', '#8b5cf6'];

  async function primeiroFetchJSON(url, opcoes = {}) {
    const resp = await fetch(url, opcoes);
    return resp.json();
  }

  /* ---------- login ---------- */
  async function verificaSessao() {
    try {
      const d = await primeiroFetchJSON('/api/me');
      if (d.auth) mostrarApp();
    } catch (_) {
      /* servidor fora do ar */
    }
  }

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    erroLogin.classList.add('hidden');
    const d = await primeiroFetchJSON('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: senhaInput.value }),
    });
    if (d.ok) {
      senhaInput.value = '';
      mostrarApp();
    } else {
      erroLogin.textContent = 'Senha incorreta.';
      erroLogin.classList.remove('hidden');
    }
  });

  btnSair.addEventListener('click', async () => {
    await primeiroFetchJSON('/api/logout', { method: 'POST' });
    location.reload();
  });

  function mostrarApp() {
    telaLogin.classList.add('hidden');
    app.classList.remove('hidden');
    carregarDados();
  }

  /* ---------- periodo ---------- */
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('ativo'));
      chip.classList.add('ativo');
      periodo = parseInt(chip.dataset.dias, 10);
      carregarDados();
    });
  });

  /* ---------- render ---------- */
  async function carregarDados() {
    $('#rodape-status').textContent = 'Carregando dados…';
    try {
      const d = await primeiroFetchJSON(`/api/dados?dias=${periodo}`);
      if (d.error) throw new Error(d.error);
      renderTudo(d);
      $('#rodape-status').textContent = `Atualizado em ${new Date().toLocaleTimeString('pt-BR')} · ${d.resumo.totalPacientes} pacientes cadastrados`;
    } catch (err) {
      console.error(err);
      $('#rodape-status').textContent = 'Erro ao carregar dados.';
    }
  }

  function renderTudo(d) {
    const r = d.resumo;
    const rotuloPeriodo = periodo === 0 ? 'todo o histórico' : `últimos ${periodo} dias`;
    $('#periodo-rotulo').textContent = `Período: ${rotuloPeriodo}`;

    $('#kpi-contatos').textContent = r.contatosPeriodo;
    $('#kpi-novos-rec').textContent = `${r.novos} novos · ${r.recorrentes} recorrentes`;

    $('#kpi-agendados').textContent = r.agendadosPeriodo;
    $('#kpi-tipos').textContent = `${r.consultaPeriodo} consultas · ${r.examePeriodo} exames`;

    $('#kpi-hoje').textContent = r.hojeCount;
    $('#kpi-semana').textContent = `${r.proximos7dCount} nos próximos 7 dias`;

    $('#kpi-conversao').textContent = `${r.taxaConversao}%`;

    $('#kpi-ia').textContent = `${r.iaAtiva} / ${r.iaPausada}`;
    $('#kpi-ia-det').textContent = 'IA ativa / pausada';

    renderBarraContatos(d.contatosPorDia);
    renderBarraAgendamentos(d.agendamentosPorDia);
    renderDonaTipos(d.distribuicaoTipo);
    renderBarrasSemana(d.porDiaSemana);
    renderBarrasHoras(d.porHora);
    renderDonaApi(d.distribuicaoApi, r.temEventos);
    renderProximos(d.proximos);
    renderContatos(d.ultimosContatos);
  }

  function renderBarraContatos(contatos) {
    novoGrafico('#grafico-contatos', {
      type: 'bar',
      data: {
        labels: contatos.map((c) => c.dia),
        datasets: [{ label: 'Novos contatos', data: contatos.map((c) => c.total), backgroundColor: paletaBarra[0], borderRadius: 6 }],
      },
      options: chartOpts('Contatos novos por dia', true),
    });
  }

  function renderBarraAgendamentos(itens) {
    const dados = itemizado(itens);
    novoGrafico('#grafico-agendamentos', {
      type: 'bar',
      data: {
        labels: dados.labels,
        datasets: [
          { label: 'Consulta', data: dados.consulta, backgroundColor: cores.consulta, borderRadius: 4 },
          { label: 'Exame', data: dados.exame, backgroundColor: cores.exame, borderRadius: 4 },
          { label: 'Outro', data: dados.outro, backgroundColor: cores.outro, borderRadius: 4 },
        ],
      },
      options: chartOpts('Agendamentos por dia', false, true),
    });
  }

  function itemizado(itens) {
    const lista = itens.length ? itens : [];
    return {
      labels: lista.map((i) => i.dia),
      consulta: lista.map((i) => i.consulta),
      exame: lista.map((i) => i.exame),
      outro: lista.map((i) => i.outro),
    };
  }

  function renderDonaTipos(tipos) {
    const dados = tipos.length ? tipos.map((t) => ({ nome: cap(t.nome), total: t.total })) : [];
    novoGrafico('#grafico-tipos', {
      type: 'doughnut',
      data: {
        labels: dados.map((t) => t.nome),
        datasets: [{ data: dados.map((t) => t.total), backgroundColor: paletaDona, borderWidth: 2, borderColor: '#fff' }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
  }

  function renderBarrasSemana(dias) {
    const ord = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    const mapa = {};
    dias.forEach((x) => (mapa[x.dia] = x.total));
    const labels = ord.map((d) => d.replace('-feira', ''));
    const totais = ord.map((d) => mapa[d] || 0);
    novoGrafico('#grafico-semana', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Agendamentos', data: totais, backgroundColor: paletaBarra[2], borderRadius: 6 }] },
      options: chartOpts('Por dia da semana'),
    });
  }

  function renderBarrasHoras(horas) {
    const mapa = {};
    horas.forEach((x) => (mapa[x.hora] = x.total));
    const labels = [];
    const totais = [];
    for (let h = 0; h < 24; h++) {
      labels.push(`${String(h).padStart(2, '0')}h`);
      totais.push(mapa[h] || 0);
    }
    novoGrafico('#grafico-horas', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Agendamentos', data: totais, backgroundColor: paletaBarra[1], borderRadius: 4 }] },
      options: chartOpts('Por horário', true),
    });
  }

  function renderDonaApi(lista, temEventos) {
    const divApi = $('#card-api');
    if (!temEventos) {
      divApi.querySelector('h2').textContent = 'Origem das mensagens (API)';
      novoGrafico('#grafico-api', { type: 'doughnut', data: { labels: ['sem dados'], datasets: [{ data: [1], backgroundColor: ['#eef1f5'] }] }, options: { plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false } });
      divApi.querySelector('h2').textContent = 'Origem (API) — configure os inserts no fluxo';
      return;
    }
    const dados = lista.length ? lista : [{ nome: 'sem dados', total: 0 }];
    novoGrafico('#grafico-api', {
      type: 'doughnut',
      data: {
        labels: dados.map((x) => cap(x.nome)),
        datasets: [{ data: dados.map((x) => x.total), backgroundColor: paletaDona, borderWidth: 2, borderColor: '#fff' }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
  }

  /* ---------- listas ---------- */
  function renderProximos(proximos) {
    const box = $('#lista-proximos');
    box.innerHTML = '';
    if (!proximos.length) {
      box.innerHTML = '<div class="vazio">Nenhum agendamento futuro.</div>';
      return;
    }
    proximos.forEach((a) => {
      const el = document.createElement('div');
      el.className = 'item-lista';
      el.innerHTML = `
        <div class="info">
          <span class="titulo"></span>
          <span class="sub"></span>
        </div>
        <span class="tag ${a.tipo}">${cap(a.tipo)}</span>`;
      el.querySelector('.titulo').textContent = a.titulo;
      el.querySelector('.sub').textContent = `${a.data} · ${a.hora}`;
      box.appendChild(el);
    });
  }

  function renderContatos(contatos) {
    const box = $('#lista-contatos');
    box.innerHTML = '';
    if (!contatos.length) {
      box.innerHTML = '<div class="vazio">Nenhum contato registrado.</div>';
      return;
    }
    contatos.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'item-lista item-clicavel';
      el.innerHTML = `
        <div class="info">
          <span class="titulo"></span>
          <span class="sub"></span>
          <span class="resumo-linha"></span>
        </div>
        <span class="seta">›</span>`;
      const sub = (c.nome ? c.telefone_mascarado + ' · ' : '') + 'Último contato: ' + c.data;
      el.querySelector('.titulo').textContent = c.nome || c.telefone_mascarado;
      el.querySelector('.sub').textContent = sub;
      el.querySelector('.resumo-linha').textContent = c.resumo || 'Sem resumo disponível.';
      el.addEventListener('click', () => abrirPaciente(c.telefone));
      box.appendChild(el);
    });
  }

  /* ---------- modal do paciente ---------- */
  const modal = $('#modal');
  const fecharModal = $('#fechar-modal');
  const boxHistorico = $('#modal-historico');

  fecharModal.addEventListener('click', fecharPaciente);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharPaciente();
  });

  function fecharPaciente() {
    modal.classList.add('hidden');
    boxHistorico.innerHTML = '';
  }

  async function abrirPaciente(telefone) {
    $('#modal-nome').textContent = 'Carregando…';
    $('#modal-sub').textContent = '';
    $('#modal-resumo').textContent = '';
    boxHistorico.innerHTML = '<div class="vazio">Carregando histórico…</div>';
    modal.classList.remove('hidden');

    try {
      const d = await primeiroFetchJSON(`/api/paciente/${encodeURIComponent(telefone)}`);
      if (d.error) throw new Error(d.error);
      $('#modal-nome').textContent = (d.paciente && (d.paciente.nome || d.paciente.telefone_mascarado)) || telefone;
      $('#modal-sub').textContent = (d.paciente && d.paciente.telefone_mascarado) || formatoTelefone(telefone);
      $('#modal-resumo').textContent = d.resumo || 'Sem resumo de conversa para este paciente.';

      boxHistorico.innerHTML = '';
      if (!d.mensagens.length) {
        boxHistorico.innerHTML = '<div class="vazio">Sem mensagens registradas na n8n_chat_histories.</div>';
      }
      d.mensagens.forEach((m) => {
        const el = document.createElement('div');
        el.className = 'bolha ' + (m.papel === 'ai' ? 'ia' : 'humana');
        el.innerHTML = `<span class="quem"></span><span class="texto"></span>`;
        el.querySelector('.quem').textContent = m.papel === 'ai' ? 'Bot' : 'Paciente';
        el.querySelector('.texto').textContent = m.conteudo;
        boxHistorico.appendChild(el);
      });
    } catch (err) {
      console.error(err);
      boxHistorico.innerHTML = '<div class="vazio">Erro ao carregar o histórico.</div>';
      $('#modal-resumo').textContent = '';
    }
  }

  function formatoTelefone(t) {
    return '•••• ' + String(t).replace(/\D/g, '').slice(-4);
  }

  /* ---------- helpers ---------- */
  function cap(s) {
    return String(s).charAt(0).toUpperCase() + String(s).slice(1);
  }

  function chartOpts(tituloTooltip, skipUnico = false, stacked = false) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: stacked },
        title: { display: false },
      },
      scales: {
        x: { grid: { display: false }, stacked },
        y: { beginAtZero: true, ticks: { precision: 0 }, stacked },
      },
    };
  }

  verificaSessao();
})();